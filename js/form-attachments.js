/* StudioLAB Growth Onboarding: form attachments widget.
   Renders inside the Review panel of every form variant (launch / scale / ai
   x AU / US). Self-contained module: holds its own state, talks to three
   edge functions, and exposes a single global init/hydrate surface that
   js/form.js wires once.

   Upload pipeline:
     1. Client pre-checks size / type / count - instant inline error.
     2. XHR POST to upload-submission-attachment (multipart, with progress).
        One upload at a time so the function's count check stays race-free.
     3. On success, push the returned row into state and re-render chips.

   Delete pipeline:
     1. Optimistic chip removal.
     2. POST to delete-submission-attachment with session_token.
     3. On failure, restore the chip and surface the error.

   Hydrate pipeline:
     Called once from form.js after the session-validate response returns
     the submission row. POSTs to list-submission-attachments. If the
     submission doesn't exist yet (studio at step 1 pre-autosave), we
     no-op and let setSubmissionId pick it up after the first autoSave.
*/

(function () {
  'use strict';

  const SB_URL = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url) || '';
  const FN_BASE = SB_URL + '/functions/v1/';

  // Mirrors upload-submission-attachment's allowlist + caps.
  const MAX_FILES = 5;
  const MAX_BYTES = 25 * 1024 * 1024;
  const ACCEPT_MIME = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ];
  const ACCEPT_ATTR =
    '.pdf,.png,.jpg,.jpeg,.svg,.docx,.doc,.xlsx,.xls,' +
    'application/pdf,image/png,image/jpeg,image/svg+xml,' +
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
    'application/msword,' +
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
    'application/vnd.ms-excel';

  const state = {
    submissionId: null,
    sessionToken: null,
    attachments: [],     // hydrated server rows
    uploading: false,    // serialise uploads
    queue: [],           // pending File objects waiting their turn
    error: '',           // last user-facing error
    activeUpload: null,  // { name, percent } during upload
    readOnly: false,     // disables zone if no session/submission yet
  };

  let bound = false;

  function $(sel, root) { return (root || document).querySelector(sel); }

  function bytesLabel(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function extLabel(name, mime) {
    const m = String(name || '').match(/\.([a-zA-Z0-9]+)$/);
    const ext = m ? m[1].toUpperCase() : '';
    if (ext) return ext;
    return String(mime || 'FILE').split('/').pop().toUpperCase();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // -- Rendering -----------------------------------------------------------
  function render() {
    const list = $('#attachList');
    const err = $('#attachErr');
    const zone = $('#attachZone');
    const counter = $('#attachCounter');
    const input = $('#attachInput');
    if (!list || !err || !zone || !counter || !input) return;

    const used = state.attachments.length + (state.activeUpload ? 1 : 0);
    counter.textContent = used + ' of ' + MAX_FILES + ' files';

    const atCap = used >= MAX_FILES;
    const blocked = state.readOnly || state.uploading || atCap;
    input.disabled = blocked;
    zone.classList.toggle('attach-zone-disabled', blocked);
    zone.setAttribute('aria-disabled', String(blocked));

    if (state.error) {
      err.textContent = state.error;
      err.classList.add('vis');
    } else {
      err.textContent = '';
      err.classList.remove('vis');
    }

    let html = '';
    for (const row of state.attachments) {
      const isStudio = row.uploaded_by_role === 'studio';
      html += renderChip(row, isStudio);
    }
    if (state.activeUpload) {
      html += renderUploadingChip(state.activeUpload);
    }
    if (!html) {
      html = '<div class="attach-empty">No files yet.</div>';
    }
    list.innerHTML = html;
  }

  function renderChip(row, removable) {
    const safeName = escapeHtml(row.file_name || 'file');
    const safeMeta = escapeHtml(extLabel(row.file_name, row.mime_type) + ' . ' + bytesLabel(row.size_bytes || 0));
    const removeBtn = removable
      ? '<button type="button" class="attach-chip-rm" data-attach-rm="' + escapeAttr(row.id) +
        '" aria-label="Remove ' + safeName + '">Remove</button>'
      : '<span class="attach-chip-locked" title="Uploaded by our team">Locked</span>';
    return (
      '<div class="attach-chip" data-attach-id="' + escapeAttr(row.id) + '">' +
        '<div class="attach-chip-ico" aria-hidden="true">' + extLabel(row.file_name, row.mime_type) + '</div>' +
        '<div class="attach-chip-body">' +
          '<div class="attach-chip-name">' + safeName + '</div>' +
          '<div class="attach-chip-meta">' + safeMeta + '</div>' +
        '</div>' +
        removeBtn +
      '</div>'
    );
  }

  function renderUploadingChip(up) {
    const safeName = escapeHtml(up.name || 'Uploading...');
    const pct = Math.max(0, Math.min(100, Math.round(up.percent || 0)));
    return (
      '<div class="attach-chip attach-chip-uploading" aria-live="polite">' +
        '<div class="attach-chip-ico" aria-hidden="true">UP</div>' +
        '<div class="attach-chip-body">' +
          '<div class="attach-chip-name">' + safeName + '</div>' +
          '<div class="attach-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">' +
            '<div class="attach-progress-fill" style="width:' + pct + '%"></div>' +
          '</div>' +
        '</div>' +
        '<span class="attach-chip-pct">' + pct + '%</span>' +
      '</div>'
    );
  }

  // -- Validation ----------------------------------------------------------
  function validateFile(file) {
    if (file.size <= 0) return 'That file is empty.';
    if (file.size > MAX_BYTES) {
      return file.name + ' is over the ' + (MAX_BYTES / 1024 / 1024) + ' MB limit.';
    }
    // Allow blank MIME (some browsers omit type on drag) - server will gate
    // it. Only reject if we have a non-empty type that isn't allowed.
    if (file.type && ACCEPT_MIME.indexOf(file.type) === -1) {
      return file.name + ' isn\'t a supported file type. We accept PDF, PNG, JPG, SVG, DOCX, DOC, XLSX, XLS.';
    }
    return null;
  }

  // -- Upload flow ---------------------------------------------------------
  function enqueue(files) {
    if (!state.submissionId || !state.sessionToken) {
      state.error = 'Save your draft first - move to the next step once and we\'ll enable uploads.';
      render();
      return;
    }
    const inFlightOrQueued = state.queue.length + (state.activeUpload ? 1 : 0);
    const remainingSlots = MAX_FILES - state.attachments.length - inFlightOrQueued;
    if (remainingSlots <= 0) {
      state.error = 'You\'ve hit the ' + MAX_FILES + '-file limit. Remove one to add another.';
      render();
      return;
    }
    let arr = Array.from(files);
    if (arr.length > remainingSlots) {
      state.error = 'Only ' + remainingSlots + ' more file' + (remainingSlots === 1 ? '' : 's') + ' fit before the ' + MAX_FILES + '-file limit.';
      arr = arr.slice(0, remainingSlots);
    } else {
      state.error = '';
    }
    for (const f of arr) {
      const reason = validateFile(f);
      if (reason) {
        state.error = reason;
        continue;
      }
      state.queue.push(f);
    }
    render();
    drainQueue();
  }

  function drainQueue() {
    if (state.uploading) return;
    if (!state.queue.length) return;
    const file = state.queue.shift();
    state.uploading = true;
    state.activeUpload = { name: file.name, percent: 0 };
    render();
    uploadOne(file)
      .then(function (row) {
        state.attachments.push(row);
        state.activeUpload = null;
        state.uploading = false;
        state.error = '';
        render();
        drainQueue();
      })
      .catch(function (err) {
        state.activeUpload = null;
        state.uploading = false;
        state.error = (err && err.message) || 'Upload failed. Please try again.';
        // Drain remaining queue so one bad file doesn't block the rest.
        render();
        drainQueue();
      });
  }

  function uploadOne(file) {
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', FN_BASE + 'upload-submission-attachment', true);
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable && state.activeUpload) {
          state.activeUpload.percent = (e.loaded / e.total) * 100;
          render();
        }
      };
      xhr.onload = function () {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (_) { /* non-JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.ok && data.attachment) {
          resolve(data.attachment);
        } else {
          const msg = (data && data.error) || ('Upload failed (' + xhr.status + ').');
          reject(new Error(msg));
        }
      };
      xhr.onerror = function () {
        reject(new Error('Network error while uploading. Please check your connection.'));
      };
      const fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('submission_id', state.submissionId);
      fd.append('session_token', state.sessionToken);
      xhr.send(fd);
    });
  }

  // -- Delete --------------------------------------------------------------
  async function removeAttachment(attachmentId) {
    const idx = state.attachments.findIndex(function (a) { return a.id === attachmentId; });
    if (idx === -1) return;
    const snapshot = state.attachments[idx];
    state.attachments.splice(idx, 1);
    state.error = '';
    render();
    try {
      const resp = await fetch(FN_BASE + 'delete-submission-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachment_id: attachmentId,
          session_token: state.sessionToken,
        }),
      });
      let data = null;
      try { data = await resp.json(); } catch (_) { /* */ }
      if (!resp.ok || !data || data.ok === false) {
        state.attachments.splice(idx, 0, snapshot);
        state.error = (data && data.error) || 'Could not remove the file. Please try again.';
        render();
      }
    } catch (e) {
      state.attachments.splice(idx, 0, snapshot);
      state.error = 'Network error while removing the file. Please try again.';
      render();
    }
  }

  // -- Event wiring --------------------------------------------------------
  function bindEvents() {
    if (bound) return;
    const zone = $('#attachZone');
    const input = $('#attachInput');
    const list = $('#attachList');
    if (!zone || !input || !list) return;

    bound = true;

    input.setAttribute('accept', ACCEPT_ATTR);

    input.addEventListener('change', function (e) {
      const files = e.target.files;
      if (files && files.length) enqueue(files);
      input.value = '';
    });

    // Click anywhere on the zone (other than the file input itself) opens
    // the picker. The input is a sibling, not nested, to allow keyboard
    // users to tab to it cleanly.
    zone.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (state.readOnly || state.uploading) return;
      input.click();
    });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!state.readOnly && !state.uploading) input.click();
      }
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        if (state.readOnly || state.uploading) return;
        zone.classList.add('attach-zone-drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      zone.addEventListener(evt, function (e) {
        e.preventDefault();
        zone.classList.remove('attach-zone-drag');
      });
    });
    zone.addEventListener('drop', function (e) {
      if (state.readOnly || state.uploading) return;
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) enqueue(dt.files);
    });

    list.addEventListener('click', function (e) {
      const rm = e.target && e.target.closest && e.target.closest('[data-attach-rm]');
      if (rm) {
        const id = rm.getAttribute('data-attach-rm');
        if (id) removeAttachment(id);
      }
    });
  }

  // -- Hydrate -------------------------------------------------------------
  async function hydrate(submissionId, sessionToken) {
    state.submissionId = submissionId || null;
    state.sessionToken = sessionToken || null;
    state.readOnly = !submissionId || !sessionToken;

    bindEvents();

    if (!submissionId || !sessionToken) {
      render();
      return;
    }
    try {
      const resp = await fetch(FN_BASE + 'list-submission-attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submission_id: submissionId, session_token: sessionToken }),
      });
      const data = await resp.json().catch(function () { return null; });
      if (resp.ok && data && data.ok && Array.isArray(data.attachments)) {
        state.attachments = data.attachments;
      } else {
        console.warn('list-submission-attachments returned non-ok:', resp.status, data);
      }
    } catch (e) {
      console.warn('list-submission-attachments failed:', e);
    }
    render();
  }

  // -- Public API ----------------------------------------------------------
  window.FormAttachments = {
    hydrate: hydrate,
    // Form code calls this after every save-draft so we pick up the
    // submission_id that auto-save freshly created.
    setSubmissionId: function (id) {
      if (!id) return;
      if (state.submissionId === id) return;
      state.submissionId = id;
      state.readOnly = !id || !state.sessionToken;
      render();
    },
    setSessionToken: function (token) {
      if (!token) return;
      state.sessionToken = token;
      state.readOnly = !state.submissionId || !token;
      render();
    },
    init: function () { bindEvents(); render(); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { window.FormAttachments.init(); });
  } else {
    window.FormAttachments.init();
  }
})();
