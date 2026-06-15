/**
 * koraa-instafeed.js
 * Lightweight Instagram Basic Display API feed loader for Grey Exim / Koraa theme.
 *
 * RCA Fix (v2):
 *  - Grid is cleared before each render to prevent post duplication
 *  - data-ki-loading guard prevents concurrent / repeated fetches per section
 *  - shopify:section:load resets guard so editor re-load works correctly
 *  - Slices API response to exactly `count` items (API may return extras)
 */

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────

  function buildApiUrl(token, count) {
    var fields = 'id,media_type,media_url,thumbnail_url,permalink,caption,timestamp';
    // Request a few extra so slicing to `count` always works even if some lack images
    var fetchLimit = Math.min(count + 4, 20);
    return (
      'https://graph.instagram.com/me/media' +
      '?fields=' + fields +
      '&limit=' + fetchLimit +
      '&access_token=' + encodeURIComponent(token)
    );
  }

  function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen).trim() + '…' : str;
  }

  function getImageSrc(item) {
    if (item.media_type === 'VIDEO') return item.thumbnail_url || item.media_url;
    return item.media_url;
  }

  function timeAgo(isoString) {
    try {
      var diff = (Date.now() - new Date(isoString).getTime()) / 1000;
      if (diff < 3600)    return Math.round(diff / 60) + 'm ago';
      if (diff < 86400)   return Math.round(diff / 3600) + 'h ago';
      if (diff < 2592000) return Math.round(diff / 86400) + 'd ago';
      return Math.round(diff / 2592000) + 'mo ago';
    } catch (e) { return ''; }
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Renderer ─────────────────────────────────────────────────────────────

  function renderPosts(posts, grid, count) {
    // ✅ FIX 1: Always clear the grid first to prevent duplication on re-render
    grid.innerHTML = '';

    var fragment = document.createDocumentFragment();
    var rendered = 0;

    posts.forEach(function (item, index) {
      // ✅ FIX 2: Stop exactly at `count` — API may return more than requested
      if (rendered >= count) return;

      var src = getImageSrc(item);
      if (!src) return;

      var caption   = truncate(item.caption, 80);
      var timeLabel = timeAgo(item.timestamp);
      var isVideo   = item.media_type === 'VIDEO';
      var isCarousel = item.media_type === 'CAROUSEL_ALBUM';

      var a = document.createElement('a');
      a.href = item.permalink;
      a.className = 'koraa-insta-feed__item';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', caption || 'Instagram post');
      a.style.setProperty('--ki-delay', rendered * 60 + 'ms');

      var img = document.createElement('img');
      img.className = 'koraa-insta-feed__img';
      img.src = src;
      img.alt = caption || 'Instagram post';
      img.loading = 'lazy';
      img.decoding = 'async';

      var overlay = document.createElement('span');
      overlay.className = 'koraa-insta-feed__overlay';
      overlay.setAttribute('aria-hidden', 'true');

      var iconSvg =
        '<svg class="koraa-insta-feed__ig-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">' +
        '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
        '<circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/>' +
        '<circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/>' +
        '</svg>';

      var badgeHtml = '';
      if (isVideo) {
        badgeHtml =
          '<span class="koraa-insta-feed__badge koraa-insta-feed__badge--video">' +
          '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>' +
          '</span>';
      } else if (isCarousel) {
        badgeHtml =
          '<span class="koraa-insta-feed__badge koraa-insta-feed__badge--carousel">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<rect x="2" y="7" width="13" height="13" rx="2"/><path d="M16 5h2a2 2 0 0 1 2 2v10"/><path d="M20 3h1a1 1 0 0 1 1 1v12"/>' +
          '</svg>' +
          '</span>';
      }

      var captionHtml = '';
      if (caption) {
        captionHtml =
          '<span class="koraa-insta-feed__caption">' +
          '<span class="koraa-insta-feed__caption-text">' + escapeHtml(caption) + '</span>' +
          '</span>';
      }

      overlay.innerHTML = iconSvg + badgeHtml + captionHtml;
      a.appendChild(img);
      a.appendChild(overlay);
      fragment.appendChild(a);
      rendered++;
    });

    grid.appendChild(fragment);

    requestAnimationFrame(function () {
      grid.querySelectorAll('.koraa-insta-feed__item').forEach(function (el) {
        el.classList.add('koraa-insta-feed__item--visible');
      });
    });
  }

  // ── Init per section ─────────────────────────────────────────────────────

  function initFeed(section) {
    var sectionId = section.dataset.sectionId;
    var token     = section.dataset.token;
    var count     = parseInt(section.dataset.count, 10) || 12;
    var grid      = document.getElementById('koraa-instafeed-' + sectionId);
    var skeleton  = document.getElementById('koraa-insta-skeleton-' + sectionId);
    var notice    = document.getElementById('koraa-insta-notice-' + sectionId);
    var noticeMsg = document.getElementById('koraa-insta-notice-msg-' + sectionId);

    // ✅ FIX 3: Guard against concurrent / repeated calls for the same section
    if (section.dataset.kiLoading === 'true') return;
    section.dataset.kiLoading = 'true';

    function showNotice(msg) {
      if (skeleton)  skeleton.style.display  = 'none';
      if (grid)      grid.style.display      = 'none';
      if (notice)    notice.style.display    = '';
      if (noticeMsg && msg) noticeMsg.textContent = msg;
      // Release guard so editor can retry after token is added
      section.dataset.kiLoading = 'false';
    }

    if (!token || token.trim() === '') {
      showNotice('Add your Instagram Access Token in the theme customizer to show live posts.');
      return;
    }

    if (!grid) {
      section.dataset.kiLoading = 'false';
      return;
    }

    fetch(buildApiUrl(token, count))
      .then(function (res) {
        if (!res.ok) throw new Error('API error: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (skeleton) skeleton.style.display = 'none';

        if (!data.data || data.data.length === 0) {
          showNotice('No Instagram posts found. Make sure your account has public posts.');
          return;
        }

        renderPosts(data.data, grid, count);
        grid.style.display = '';
        // Release guard — allow future editor-triggered reloads
        section.dataset.kiLoading = 'false';
      })
      .catch(function (err) {
        console.warn('[Koraa Instagram Feed]', err.message);
        var msg = 'Could not load Instagram feed.';
        if (err.message && err.message.indexOf('190') !== -1) {
          msg = 'Instagram access token has expired. Please refresh it in the theme settings.';
        } else if (err.message && (err.message.indexOf('400') !== -1 || err.message.indexOf('401') !== -1)) {
          msg = 'Invalid Instagram access token. Please check the token in theme settings.';
        }
        showNotice(msg);
      });
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  function bootstrap() {
    document.querySelectorAll('.koraa-insta-feed[data-section-id]').forEach(initFeed);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // Shopify theme editor — section reload event
  // ✅ FIX 4: Reset the guard before re-initialising so editor changes apply
  document.addEventListener('shopify:section:load', function (e) {
    var el = e.target && e.target.querySelector('.koraa-insta-feed[data-section-id]');
    if (!el) return;
    el.dataset.kiLoading = 'false'; // reset guard on editor reload
    initFeed(el);
  });

})();
