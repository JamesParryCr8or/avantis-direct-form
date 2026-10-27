/* Shared phone formatting and SMS flow for the lead form and contact edits. */
window.ContactValidation = (() => {
  const instances = new Map();
  const smsNotes = new Map();
  const buttonLabels = new WeakMap();
  function setLoading(button, label) {
    if (!buttonLabels.has(button)) buttonLabels.set(button, button.innerHTML);
    button.disabled = true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy', 'true');
    button.textContent = label;
  }
  function clearLoading(button) {
    button.disabled = false;
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    if (buttonLabels.has(button)) button.innerHTML = buttonLabels.get(button);
    buttonLabels.delete(button);
  }
  function showEmailResult(email, status, message) {
    const input = document.getElementById('f-email') || document.getElementById('p2-email');
    if (!input || input.value.trim().toLowerCase() !== email.trim().toLowerCase()) return;
    const failed = ['invalid', 'unverified', 'unknown'].includes(status);
    input.classList.toggle('invalid', failed);
    input.classList.toggle('valid', !failed);
    input.setAttribute('aria-invalid', String(failed));
    const icon = document.getElementById('icon-email');
    if (icon) icon.textContent = failed ? '❌' : '✅';
    const error = document.getElementById('err-email');
    if (error) {
      error.textContent = message || (status === 'invalid' ? 'Please check your email address.' : "We couldn't verify this email address. Please check it is correct.");
      error.classList.toggle('show', failed);
    }
    // Keep the provider result visible until this address is actually edited.
    input.dataset.emailValidation = JSON.stringify({ email: input.value.trim().toLowerCase(), status, message });
  }
  function restoreEmailResult() {
    const input = document.getElementById('f-email') || document.getElementById('p2-email');
    if (!input?.dataset.emailValidation) return;
    const result = JSON.parse(input.dataset.emailValidation);
    if (input.value.trim().toLowerCase() === result.email) showEmailResult(result.email, result.status, result.message);
    else { delete input.dataset.emailValidation; input.removeAttribute('aria-invalid'); }
  }
  let pendingChallenge = '';
  const saved = () => {
    try { return JSON.parse(sessionStorage.getItem('avantis_verification') || 'null'); } catch { return null; }
  };
  async function post(body) {
    const response = await fetch('/api/phone-verification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      if (data.field === 'email') showEmailResult(body.email, 'invalid', data.error);
      throw new Error(data.error || 'Verification failed. Please try again.');
    }
    return data;
  }
  function init(id, options = {}) {
    const input = document.getElementById(id);
    const instance = window.intlTelInput(input, {
      initialCountry: options.initialCountry || 'gb', countryOrder: options.countryOrder || ['gb', 'ie', 'us'], separateDialCode: true,
      strictMode: true, validationNumberTypes: ['MOBILE', 'FIXED_LINE_OR_MOBILE'],
      loadUtils: () => import('/vendor/intl-tel-input/js/utils.js'),
    });
    instances.set(id, instance);
    smsNotes.set(id, options.smsNote || 'SMS verification is available for UK and Irish mobiles.');
    const emailInput = document.getElementById('f-email') || document.getElementById('p2-email');
    if (emailInput && !document.getElementById('icon-email')) {
      const wrap = document.createElement('div');
      wrap.className = 'email-validation-wrap';
      emailInput.before(wrap);
      wrap.appendChild(emailInput);
      const icon = document.createElement('span');
      icon.id = 'icon-email'; icon.className = 'email-validation-icon'; icon.setAttribute('aria-hidden', 'true');
      wrap.appendChild(icon);
    }
    emailInput?.addEventListener('input', () => {
      if (typeof window.validateEmail === 'function') window.validateEmail();
      else restoreEmailResult();
    });
    // Existing inline validators may run while utilities are loading.
    instance.promise.then(() => { if (input.value) input.dispatchEvent(new Event('input')); }).catch(() => {});
    input.addEventListener('countrychange', () => input.dispatchEvent(new Event('input')));
    return instance;
  }
  function valid(id) { return instances.get(id)?.isValidNumber() === true; }
  function number(id) { return instances.get(id)?.getNumber() || ''; }
  function setNumber(id, value) { instances.get(id)?.setNumber(value || ''); }
  async function ensure(id, rawEmail) {
    const instance = instances.get(id);
    try { await instance.promise; } catch { throw new Error('Phone validation could not load. Please refresh and try again.'); }
    if (!valid(id)) throw new Error('Please enter a valid mobile number.');
    const phone = number(id);
    const email = rawEmail.trim().toLowerCase();
    const existing = saved();
    if (existing?.phone === phone && existing.email === email && existing.expires > Date.now()) {
      if (existing.emailStatus) showEmailResult(email, existing.emailStatus);
      return existing.token;
    }
    const first = await post({ action: 'send', phone, email, challenge: pendingChallenge });
    showEmailResult(email, first.emailStatus || 'unknown');
    pendingChallenge = first.challenge;
    return new Promise((resolve, reject) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'contact-dialog';
      dialog.setAttribute('aria-labelledby', 'verify-title');
      dialog.innerHTML = `<form method="dialog"><h2 id="verify-title">Verify your mobile</h2>
        <p class="verify-description"></p><label for="verify-code">Text message code</label>
        <input id="verify-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,10}" maxlength="10" required>
        <p class="verify-error" role="alert"></p><button class="verify-confirm" type="submit">Verify and continue</button>
        <div class="verify-actions"><button type="button" class="verify-cancel">Change details</button><button type="button" class="verify-resend">Resend code</button></div></form>`;
      dialog.querySelector('.verify-description').textContent = `We sent a code to ${phone}. Enter it below to continue. ${smsNotes.get(id)}`;
      const code = dialog.querySelector('input');
      const error = dialog.querySelector('.verify-error');
      const confirm = dialog.querySelector('.verify-confirm');
      const resend = dialog.querySelector('.verify-resend');
      let availableAt = Date.now() + first.retryAfter * 1000;
      let busy = false;
      const timer = setInterval(() => {
        const seconds = Math.max(0, Math.ceil((availableAt - Date.now()) / 1000));
        resend.disabled = busy || seconds > 0;
        resend.textContent = seconds ? `Resend in ${seconds}s` : 'Resend code';
      }, 250);
      resend.disabled = true;
      const cleanup = () => { clearInterval(timer); dialog.close(); dialog.remove(); };
      const cancel = () => { if (!busy) { cleanup(); reject(new Error('Verification cancelled. You can change your details and try again.')); } };
      dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
      dialog.querySelector('.verify-cancel').onclick = cancel;
      resend.onclick = async () => {
        if (busy || Date.now() < availableAt) return;
        busy = true; error.textContent = ''; confirm.disabled = true;
        setLoading(resend, 'Sending…');
        try {
          const data = await post({ action: 'send', phone, email, challenge: pendingChallenge });
          pendingChallenge = data.challenge; availableAt = Date.now() + data.retryAfter * 1000;
          code.value = ''; code.focus();
        } catch (err) { error.textContent = err.message; }
        finally { busy = false; confirm.disabled = false; clearLoading(resend); }
      };
      dialog.querySelector('form').onsubmit = async event => {
        event.preventDefault();
        if (busy) return;
        busy = true; setLoading(confirm, 'Verifying…'); error.textContent = '';
        try {
          const data = await post({ action: 'check', phone, email, code: code.value.trim(), challenge: pendingChallenge });
          try { sessionStorage.setItem('avantis_verification', JSON.stringify({ phone, email, emailStatus: first.emailStatus, token: data.verificationToken, expires: Date.now() + 29 * 60000 })); } catch {}
          cleanup(); resolve(data.verificationToken);
        } catch (err) { error.textContent = err.message; code.focus(); }
        finally { busy = false; clearLoading(confirm); }
      };
      document.body.appendChild(dialog); dialog.showModal(); code.focus();
    });
  }
  return { init, valid, number, setNumber, ensure, setLoading, clearLoading, restoreEmailResult };
})();
