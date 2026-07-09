import { DialogComponent, DialogOpenEvent, DialogCloseEvent } from '@theme/dialog';
import { CartAddEvent } from '@theme/events';
import { isMobileBreakpoint } from '@theme/utilities';

/**
 * A custom element that manages a cart drawer.
 *
 * @typedef {object} Refs
 * @property {HTMLDialogElement} dialog - The dialog element.
 * @property {HTMLElement} [liveRegion] - The live region for cart announcements when dialog is open.
 *
 * @extends {DialogComponent}
 */
class CartDrawerComponent extends DialogComponent {
  /** @type {number} */
  #summaryThreshold = 0.5;

  /** @type {AbortController | null} */
  #historyAbortController = null;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    this.addEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.addEventListener(DialogOpenEvent.eventName, this.#handleHistoryOpen);
    this.addEventListener(DialogCloseEvent.eventName, this.#handleHistoryClose);

    if (history.state?.cartDrawerOpen) {
      history.replaceState(null, '');
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(CartAddEvent.eventName, this.#handleCartAdd);
    this.removeEventListener(DialogOpenEvent.eventName, this.#updateStickyState);
    this.removeEventListener(DialogOpenEvent.eventName, this.#handleHistoryOpen);
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleHistoryClose);
    this.#historyAbortController?.abort();
  }

  #handleHistoryOpen = () => {
    if (!isMobileBreakpoint()) return;

    if (!history.state?.cartDrawerOpen) {
      history.pushState({ cartDrawerOpen: true }, '');
    }

    this.#historyAbortController = new AbortController();
    window.addEventListener('popstate', this.#handlePopState, { signal: this.#historyAbortController.signal });
  };

  #handleHistoryClose = () => {
    this.#historyAbortController?.abort();
    if (history.state?.cartDrawerOpen) {
      history.back();
    }
  };

  #handlePopState = async () => {
    if (this.refs.dialog?.open) {
      this.refs.dialog.style.setProperty('--dialog-drawer-closing-animation', 'none');
      await this.closeDialog();
      this.refs.dialog.style.removeProperty('--dialog-drawer-closing-animation');
    }
  };

  /**
   * Handles cart add events - opens drawer if auto-open and announces count when open.
   * @param {CustomEvent<{ resource?: { item_count?: number } }>} event
   */
  #handleCartAdd = (event) => {
    if (this.hasAttribute('auto-open')) {
      this.showDialog();
    }

    this.#announceCartCount(event.detail.resource?.item_count);
  };

  /**
   * Announces cart count to screen readers when dialog is open.
   * @param {number | undefined} cartCount
   */
  #announceCartCount(cartCount) {
    const liveRegion = /** @type {HTMLElement | undefined} */ (this.refs.liveRegion);
    if (!this.refs.dialog?.open || !liveRegion || cartCount === undefined) return;

    liveRegion.textContent = `${Theme.translations.cart_count}: ${cartCount}`;
  }

  open() {
    this.showDialog();

    /**
     * Close cart drawer when installments CTA is clicked to avoid overlapping dialogs
     */
    customElements.whenDefined('shopify-payment-terms').then(() => {
      const installmentsContent = document.querySelector('shopify-payment-terms')?.shadowRoot;
      const cta = installmentsContent?.querySelector('#shopify-installments-cta');
      cta?.addEventListener('click', this.closeDialog, { once: true });
    });
  }

  close() {
    this.closeDialog();
  }

  #updateStickyState() {
    const { dialog } = /** @type {Refs} */ (this.refs);
    if (!dialog) return;

    // Refs do not cross nested `*-component` boundaries (e.g., `cart-items-component`), so we query within the dialog.
    const content = dialog.querySelector('.cart-drawer__content');
    const summary = dialog.querySelector('.cart-drawer__summary');

    if (!content || !summary) {
      // Ensure the dialog doesn't get stuck in "unsticky" mode when summary disappears (e.g., empty cart).
      dialog.setAttribute('cart-summary-sticky', 'false');
      return;
    }

    const drawerHeight = dialog.getBoundingClientRect().height;
    const summaryHeight = summary.getBoundingClientRect().height;
    const ratio = summaryHeight / drawerHeight;
    dialog.setAttribute('cart-summary-sticky', ratio > this.#summaryThreshold ? 'false' : 'true');
  }
}

if (!customElements.get('cart-drawer-component')) {
  customElements.define('cart-drawer-component', CartDrawerComponent);
}

// Inline Size Selector Ajax Logic
class CartVariantUpdater extends HTMLElement {
  constructor() {
    super();
    this.buttons = this.querySelectorAll('.cart-size-btn');
    this.buttons.forEach(btn => btn.addEventListener('click', this.handleVariantChange.bind(this)));
  }

  async handleVariantChange(event) {
    const btn = event.currentTarget;
    if (btn.classList.contains('is-selected')) return;
    
    const newVariantId = btn.dataset.variantId;
    const qty = btn.dataset.qty;
    const oldLineKey = this.dataset.lineKey;

    btn.style.opacity = '0.5';

    try {
      // 1. Add new variant
      await fetch(window.Shopify.routes.root + 'cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: newVariantId, quantity: parseInt(qty) }] })
      });

      // 2. Remove old variant
      await fetch(window.Shopify.routes.root + 'cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: oldLineKey, quantity: 0 })
      });

      // 3. Trigger native cart refresh event
      // Dawn / Horizon themes use cart:update or dispatch event to cart-drawer
      const cartDrawer = document.querySelector('cart-drawer-component');
      if (cartDrawer && cartDrawer.fetchCart) {
        cartDrawer.fetchCart();
      } else {
        document.dispatchEvent(new CustomEvent('cart:update', { bubbles: true, detail: { cart: null } }));
        // Also trigger page reload if all else fails
        setTimeout(() => window.location.reload(), 1000);
      }
    } catch (e) {
      console.error('Variant update failed', e);
      btn.style.opacity = '1';
    }
  }
}
if (!customElements.get('cart-variant-updater')) {
  customElements.define('cart-variant-updater', CartVariantUpdater);
}

// Mobile Bottom Slide-Up Swipe-to-Close Logic
document.addEventListener('touchstart', (e) => {
  const drawer = e.target.closest('.cart-drawer__dialog');
  if (drawer && window.innerWidth <= 749) {
    // Only capture swipe if we are not scrolling a scrollable area inside the drawer,
    // or if the scrollable area is at the very top.
    const scrollableContent = e.target.closest('.cart-drawer__items');
    if (scrollableContent && scrollableContent.scrollTop > 0) return;

    drawer.dataset.startY = e.touches[0].clientY;
    drawer.dataset.currentY = e.touches[0].clientY;
    drawer.style.transition = 'none';
  }
}, {passive: true});

document.addEventListener('touchmove', (e) => {
  const drawer = e.target.closest('.cart-drawer__dialog');
  if (drawer && drawer.dataset.startY && window.innerWidth <= 749) {
    const startY = parseFloat(drawer.dataset.startY);
    const currentY = e.touches[0].clientY;
    drawer.dataset.currentY = currentY;
    
    const deltaY = currentY - startY;
    // Only allow dragging down
    if (deltaY > 0) {
      drawer.style.transform = `translateY(${deltaY}px)`;
    }
  }
}, {passive: true});

document.addEventListener('touchend', (e) => {
  const drawer = e.target.closest('.cart-drawer__dialog');
  if (drawer && drawer.dataset.startY && window.innerWidth <= 749) {
    const startY = parseFloat(drawer.dataset.startY);
    const currentY = parseFloat(drawer.dataset.currentY);
    const deltaY = currentY - startY;
    
    drawer.style.transition = ''; 
    drawer.style.transform = ''; 
    
    if (deltaY > 120) {
      const closeBtn = drawer.querySelector('.cart-drawer__close-button');
      if (closeBtn) closeBtn.click();
    }
    
    delete drawer.dataset.startY;
    delete drawer.dataset.currentY;
  }
});
