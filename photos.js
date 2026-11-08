// Photos on time entries and planned shifts. Loaded before app.js; uses app.js helpers
// ($, state, showToast, formatDateTime, personName, ...) only when called.
const PHOTO_MAX_SIDE = 1600;
const PHOTO_QUALITY = 0.82;
let livePhotosKey = '';
let viewerAttachmentId = null;

function photosEnabled() { return Boolean(window.TempoCloud?.photosAvailable?.()); }

function photosFor({ entryId = null, shiftId = null }) {
  return (state.attachments || []).filter((item) => (entryId && item.entryId === entryId) || (shiftId && item.shiftId === shiftId));
}

function photoBadge(target) {
  const count = photosFor(target).length;
  return count ? ` <span class="photo-badge" title="${count} photo${count === 1 ? '' : 's'}">📷 ${count}</span>` : '';
}

function canDeletePhoto(attachment) {
  return attachment.createdBy === state.currentUserId || currentRoleKey() === 'owner';
}

// Shrinks a camera photo to a sensible size and re-encodes it as JPEG (also fixes rotation).
async function resizePhoto(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That photo format isn\'t supported here. Try a JPEG or PNG.')); };
      image.src = url;
    });
  }
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
  if (!blob) throw new Error('The photo could not be prepared for upload.');
  return { blob, width: canvas.width, height: canvas.height };
}

function photoStripHtml(target, { compact = false } = {}) {
  if (!photosEnabled()) return window.TempoCloud?.isConnected?.() ? '' : '<p class="muted small-text photo-note">Photos are available when you\'re signed in and online.</p>';
  const items = photosFor(target);
  const attrs = target.entryId ? `data-entry-id="${target.entryId}"` : `data-shift-id="${target.shiftId}"`;
  const thumbs = items.map((item) => `<button type="button" class="photo-thumb" data-photo-id="${item.id}" data-photo-path="${escapeHtml(item.path)}" aria-label="Open photo${item.caption ? `: ${escapeHtml(item.caption)}` : ''}"><img alt="${escapeHtml(item.caption || 'Photo')}" loading="lazy" /></button>`).join('');
  return `<div class="photo-strip ${compact ? 'compact' : ''}" ${attrs}>${compact ? '' : `<div class="photo-strip-title">Photos${items.length ? ` · ${items.length}` : ''}</div>`}<div class="photo-grid">${thumbs}<label class="photo-add"><input type="file" accept="image/*" multiple data-photo-input ${attrs} /><span class="photo-add-icon">＋</span><span>Add photo</span></label></div></div>`;
}

async function hydrateThumbnails(root = document) {
  const buttons = [...root.querySelectorAll('.photo-thumb[data-photo-path]')].filter((button) => !button.querySelector('img').src);
  if (!buttons.length) return;
  const urls = await window.TempoCloud.photoUrls([...new Set(buttons.map((button) => button.dataset.photoPath))]);
  buttons.forEach((button) => { const url = urls.get(button.dataset.photoPath); if (url) button.querySelector('img').src = url; });
}

function mountPhotos(selector, target, options) {
  const container = typeof selector === 'string' ? $(selector) : selector;
  if (!container) return;
  container.innerHTML = target && (target.entryId || target.shiftId) ? photoStripHtml(target, options) : '';
  container.dataset.photoTarget = target ? JSON.stringify(target) : '';
  hydrateThumbnails(container);
}

// Re-draws every photo area on screen after an upload, delete or sync.
function remountPhotos() {
  document.querySelectorAll('[data-photo-target]').forEach((container) => {
    if (!container.dataset.photoTarget) return;
    const compact = container.classList.contains('live-photos');
    mountPhotos(container, JSON.parse(container.dataset.photoTarget), { compact });
  });
}

// The Live tracking card: photos for the running clock, redrawn only when they change.
function renderLivePhotos(entry) {
  const container = $('#live-photos');
  if (!container) return;
  const key = entry && photosEnabled() ? `${entry.id}|${photosFor({ entryId: entry.id }).map((item) => item.id).join(',')}` : '';
  if (key === livePhotosKey) return;
  livePhotosKey = key;
  container.classList.toggle('hidden', !key);
  mountPhotos(container, key ? { entryId: entry.id } : null, { compact: true });
}

async function handlePhotoInput(input) {
  const files = [...(input.files || [])];
  input.value = '';
  if (!files.length) return;
  const target = { entryId: input.dataset.entryId || null, shiftId: input.dataset.shiftId || null };
  const label = input.closest('.photo-add');
  label?.classList.add('busy');
  let saved = 0;
  try {
    for (const file of files) {
      showToast(files.length > 1 ? `Uploading photo ${saved + 1} of ${files.length}…` : 'Uploading photo…');
      const { blob, width, height } = await resizePhoto(file);
      await window.TempoCloud.uploadPhoto({ ...target, blob, width, height });
      saved += 1;
    }
    showToast(saved === 1 ? 'Photo added' : `${saved} photos added`);
  } catch (error) {
    showToast(error?.message || 'The photo could not be added');
  } finally {
    label?.classList.remove('busy');
    livePhotosKey = '';
    remountPhotos();
  }
}

async function openPhotoViewer(attachmentId) {
  const item = (state.attachments || []).find((attachment) => attachment.id === attachmentId);
  if (!item) return;
  viewerAttachmentId = item.id;
  const urls = await window.TempoCloud.photoUrls([item.path]);
  const url = urls.get(item.path);
  $('#photo-viewer-image').src = url || '';
  $('#photo-viewer-image').alt = item.caption || 'Photo';
  $('#photo-viewer-open').href = url || '#';
  const parent = item.entryId ? state.entries.find((entry) => entry.id === item.entryId) : state.shifts.find((shift) => shift.id === item.shiftId);
  $('#photo-viewer-title').textContent = parent ? `${jobName(parent.jobId)}${item.shiftId ? ' · planned shift' : ''}` : 'Photo';
  $('#photo-viewer-meta').textContent = `Added by ${personName(item.createdBy)} · ${formatDateTime(item.createdAt)}`;
  $('#photo-viewer-delete').classList.toggle('hidden', !canDeletePhoto(item));
  openModal('photo-viewer');
}

async function deleteViewedPhoto() {
  const item = (state.attachments || []).find((attachment) => attachment.id === viewerAttachmentId);
  if (!item || !canDeletePhoto(item)) return;
  if (!window.confirm('Delete this photo? This can\'t be undone.')) return;
  try {
    await window.TempoCloud.deletePhoto(item);
    closeModal('photo-viewer');
    showToast('Photo deleted');
  } catch (error) {
    showToast(error?.message || 'The photo could not be deleted');
  } finally {
    livePhotosKey = '';
    remountPhotos();
  }
}

function bindPhotoEvents() {
  document.addEventListener('change', (event) => { if (event.target.matches?.('[data-photo-input]')) handlePhotoInput(event.target); });
  document.addEventListener('click', (event) => { const thumb = event.target.closest?.('.photo-thumb'); if (thumb) openPhotoViewer(thumb.dataset.photoId); });
  $('#photo-viewer-delete').addEventListener('click', deleteViewedPhoto);
}
