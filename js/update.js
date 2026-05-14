/* StudioLAB Growth: magic-link update page.
   URL: /update.html?token=RAW_TOKEN
   Validates the token via the validate-change-request Edge Function, renders
   only the requested fields, then applies the changes via apply-change-request. */

(function () {
  'use strict';

  const sb = window.initSupabase ? window.initSupabase() : null;

  // Field registry: every field an admin might request must be defined here.
  // Keys are the submission column names so the apply Edge Function can write
  // them back directly.
  const FIELDS = {
    // Studio details
    studio_name:        { label: 'Studio name', type: 'text', required: true },
    legal_name:         { label: 'Legal business name', type: 'text' },
    // Options are populated at render time from the studio's existing currency
    // package: AUD studios can only select Australia, USD studios choose from
    // US/Canada/UK/NZ or type a custom country via "Other".
    country:            { label: 'Country', type: 'select', required: true, options: [] },
    timezone:           { label: 'Time zone', type: 'text' },
    studio_type:        { label: 'Studio type', type: 'text' },
    address:            { label: 'Studio address', type: 'text', required: true },
    website:            { label: 'Website URL', type: 'url', required: true },
    support_url:        { label: 'Support or contact page URL', type: 'url' },

    // Primary contact
    first_name:         { label: 'First name', type: 'text', required: true },
    last_name:          { label: 'Last name', type: 'text', required: true },
    contact_email:      { label: 'Email address', type: 'email', required: true },
    contact_phone:      { label: 'Phone number', type: 'tel', required: true },
    role:               { label: 'Role', type: 'text' },
    studiolab_email:    { label: 'StudioLAB login email', type: 'email' },

    // Branding
    primary_colour:     { label: 'Primary colour (hex)', type: 'colour', required: true },
    secondary_colour:   { label: 'Secondary colour (hex)', type: 'colour' },
    sign_off:           { label: 'Email sign-off', type: 'text' },
    email_tone:         { label: 'Email tone', type: 'text' },
    footer_notes:       { label: 'Footer notes', type: 'textarea' },
    studio_description: { label: 'Studio description', type: 'textarea' },

    // Email setup
    from_name:          { label: 'From name', type: 'text', required: true },
    reply_email:        { label: 'Reply-to email', type: 'email', required: true },
    email_domain:       { label: 'Email domain', type: 'text' },
    dns_access:         { label: 'DNS access', type: 'text' },

    // SMS & social
    sms_type:           { label: 'SMS number preference', type: 'text' },
    area_code:          { label: 'Preferred area code', type: 'text' },
    port_number:        { label: 'Existing number to port', type: 'tel' },
    sms_tone:           { label: 'SMS tone notes', type: 'text' },

    // AI KB
    kb_profile:         { label: 'Studio locations, hours and contact', type: 'textarea' },
    kb_classes:         { label: 'Classes and timetable', type: 'textarea' },
    kb_pricing:         { label: 'Tuition fees and pricing', type: 'textarea' },
    kb_policies:        { label: 'Studio policies', type: 'textarea' },
    kb_events:          { label: 'Upcoming events', type: 'textarea' },
    kb_restricted:      { label: 'Restricted topics', type: 'textarea' },
    kb_tone:            { label: 'AI tone and personality', type: 'textarea' },
    voice_hours:        { label: 'Voice agent activation hours', type: 'text' },
    voice_escalate:     { label: 'When the AI should escalate', type: 'textarea' },

    extra_notes:        { label: 'Additional notes', type: 'textarea' },
  };

  const $ = (s) => document.querySelector(s);
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const isUrl = (v) => { try { new URL(v); return true; } catch (e) { return false; } };
  const isHex = (v) => /^#[0-9A-Fa-f]{6}$/.test(v);

  function getToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get('token') || '';
  }

  async function callFn(name, body) {
    if (!sb) throw new Error('Supabase client not initialised.');
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) throw error;
    return data;
  }

  let context = null; // { submission, fields: [...], message }

  async function start() {
    const token = getToken();
    if (!token) { showInvalid(); return; }

    try {
      const result = await callFn('validate-change-request', { token });
      if (!result || !result.valid) { showInvalid(); return; }
      context = result;
      renderForm();
    } catch (err) {
      console.error('Validation failed:', err);
      showInvalid();
    }
  }

  function showInvalid() {
    show('up-loading', false);
    show('up-invalid', true);
  }

  function renderForm() {
    show('up-loading', false);
    show('up-form', true);
    $('#up-admin-msg').innerHTML = context.message
      ? '<strong>From our team:</strong> ' + escapeHtml(context.message)
      : '<strong>We need a few details confirmed before we continue with your setup.</strong>';

    const container = $('#up-fields');
    container.innerHTML = '';

    context.fields.forEach((key) => {
      const def = FIELDS[key];
      if (!def) return; // unknown field, skip
      const current = context.submission ? context.submission[key] : '';
      container.appendChild(renderField(key, def, current));
    });
  }

  function renderField(key, def, current) {
    const card = document.createElement('div');
    card.className = 'card';
    const wrap = document.createElement('div');
    wrap.className = 'f';
    wrap.dataset.key = key;

    const errId = 'up-err-' + key;
    const label = document.createElement('label');
    label.setAttribute('for', 'up-' + key);
    label.innerHTML = escapeHtml(def.label) + (def.required ? ' <span class="req">*</span>' : '');
    wrap.appendChild(label);

    let input;
    if (def.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = 4;
      input.value = current || '';
    } else if (def.type === 'select') {
      input = document.createElement('select');
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = 'Select';
      input.appendChild(blank);
      // Country options are package-scoped: AUD = Australia only; USD = the
      // four supported English-speaking markets plus a manual "Other" entry.
      let options = def.options || [];
      if (key === 'country') {
        const existing = (context.submission && context.submission.country) || '';
        if (existing === 'AU') {
          options = [['AU','Australia']];
        } else {
          options = [
            ['US','United States'],
            ['CA','Canada'],
            ['UK','United Kingdom'],
            ['NZ','New Zealand'],
            ['OTHER','Other (enter below)'],
          ];
        }
      }
      let matched = false;
      options.forEach(([v, lbl]) => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = lbl;
        if (current === v) { opt.selected = true; matched = true; }
        input.appendChild(opt);
      });
      // Country: if the stored value isn't a known code (and this is a USD
      // studio), route to OTHER and pre-fill the manual input below.
      const isUsdCountry = key === 'country' && (!context.submission || context.submission.country !== 'AU');
      if (key === 'country' && !matched && current && isUsdCountry) {
        const otherOpt = input.querySelector('option[value="OTHER"]');
        if (otherOpt) otherOpt.selected = true;
      }
    } else if (def.type === 'colour') {
      const cf = document.createElement('div');
      cf.className = 'cf';
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = isHex(current || '') ? current : '#E8197F';
      picker.setAttribute('aria-label', def.label + ' picker');
      picker.setAttribute('tabindex', '-1');
      const text = document.createElement('input');
      text.type = 'text';
      text.maxLength = 7;
      text.value = current || '';
      text.id = 'up-' + key;
      text.setAttribute('aria-describedby', errId);
      text.setAttribute('aria-invalid', 'false');
      if (def.required) text.dataset.required = '';
      picker.addEventListener('input', () => { text.value = picker.value.toUpperCase(); });
      text.addEventListener('input', () => {
        if (isHex(text.value.trim())) picker.value = text.value.trim();
      });
      cf.appendChild(picker);
      cf.appendChild(text);
      wrap.appendChild(cf);
      const err = document.createElement('span');
      err.className = 'field-err';
      err.id = errId;
      err.textContent = 'Please enter a valid 6-digit hex colour.';
      wrap.appendChild(err);
      card.appendChild(wrap);
      return card;
    } else {
      input = document.createElement('input');
      input.type = def.type;
      input.value = current || '';
    }

    input.id = 'up-' + key;
    input.setAttribute('aria-describedby', errId);
    input.setAttribute('aria-invalid', 'false');
    if (def.required) input.dataset.required = '';
    wrap.appendChild(input);

    // Country (USD studios only): add a manual text input that shows whenever
    // the select is on OTHER, so studios outside our supported list can still
    // submit a real country name. collectValues() reads it via the same key.
    if (key === 'country' && input.tagName === 'SELECT') {
      const hasOther = !!input.querySelector('option[value="OTHER"]');
      if (hasOther) {
        const other = document.createElement('input');
        other.type = 'text';
        other.id = 'up-country-other';
        other.placeholder = 'Country name';
        other.setAttribute('autocomplete', 'country-name');
        other.style.marginTop = '8px';
        if (input.value !== 'OTHER') other.hidden = true;
        else other.value = (current && current !== 'OTHER') ? current : '';
        input.addEventListener('change', () => {
          const isOther = input.value === 'OTHER';
          other.hidden = !isOther;
          if (!isOther) other.value = '';
        });
        wrap.appendChild(other);
      }
    }

    const err = document.createElement('span');
    err.className = 'field-err';
    err.id = errId;
    err.textContent = def.type === 'email' ? 'Please enter a valid email.'
                    : def.type === 'url'   ? 'Please enter a valid URL.'
                    : 'This field is required.';
    wrap.appendChild(err);

    card.appendChild(wrap);
    return card;
  }

  function collectValues() {
    const out = {};
    let ok = true;
    let firstBad = null;

    context.fields.forEach((key) => {
      const def = FIELDS[key];
      if (!def) return;
      const wrap = document.querySelector('[data-key="' + key + '"]');
      if (!wrap) return;
      let v;
      if (def.type === 'colour') {
        v = (wrap.querySelector('input[type="text"]').value || '').trim();
      } else {
        v = (wrap.querySelector('#up-' + CSS.escape(key))?.value || '').trim();
      }

      // Country: when the select is on OTHER, substitute the manually typed
      // country name so we store a real value instead of the literal "OTHER".
      if (key === 'country' && v === 'OTHER') {
        v = (wrap.querySelector('#up-country-other')?.value || '').trim();
      }

      let bad = def.required && !v;
      if (!bad && v) {
        if (def.type === 'email') bad = !isEmail(v);
        else if (def.type === 'url') bad = !isUrl(v);
        else if (def.type === 'colour') bad = !isHex(v);
      }
      wrap.classList.toggle('has-error', bad);
      const inp = wrap.querySelector('input, select, textarea');
      if (inp) inp.setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (bad) {
        ok = false;
        if (!firstBad) firstBad = wrap;
      }
      out[key] = v || null;
    });

    if (firstBad) {
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const inp = firstBad.querySelector('input, select, textarea');
      if (inp) inp.focus({ preventScroll: true });
    }
    return ok ? out : null;
  }

  async function save() {
    const values = collectValues();
    if (!values) return;
    const btn = $('#up-save');
    const err = $('#up-err');
    err.classList.remove('vis');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span> Saving...';
    try {
      await callFn('apply-change-request', { token: getToken(), values });
      show('up-form', false);
      show('up-saved', true);
      const saved = document.getElementById('up-saved');
      if (saved) saved.focus();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      console.error('Save failed:', e);
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.innerHTML = orig;
      err.classList.add('vis');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  document.addEventListener('submit', (e) => {
    if (e.target && e.target.id === 'up-form') {
      e.preventDefault();
      save();
    }
  });
  document.addEventListener('input', (e) => {
    const wrap = e.target.closest('.f');
    if (wrap) {
      wrap.classList.remove('has-error');
      const inp = wrap.querySelector('input, select, textarea');
      if (inp) inp.setAttribute('aria-invalid', 'false');
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
