import { nextTick, onBeforeUnmount, watch, type Ref } from "vue";

interface FocusTarget {
  focus(): void;
}

interface UseModalFocusOptions {
  open: () => boolean;
  container: Readonly<Ref<HTMLElement | null>>;
  close: () => void;
  initialFocus?: () => FocusTarget | null;
}

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useModalFocus({
  open,
  container,
  close,
  initialFocus,
}: UseModalFocusOptions): void {
  let previousFocus: HTMLElement | null = null;
  let background: HTMLElement | null = null;

  function focusableElements(): HTMLElement[] {
    if (!container.value) return [];
    return Array.from(container.value.querySelectorAll<HTMLElement>(focusableSelector)).filter(
      (element) => element.getAttribute("aria-hidden") !== "true",
    );
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!open()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const elements = focusableElements();
    if (elements.length === 0) {
      event.preventDefault();
      container.value?.focus();
      return;
    }

    const first = elements[0];
    const last = elements[elements.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !container.value?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !container.value?.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function deactivate(restoreFocus: boolean): void {
    document.removeEventListener("keydown", handleKeydown, true);
    if (background) {
      background.inert = false;
      background.removeAttribute("aria-hidden");
      background = null;
    }
    if (restoreFocus) previousFocus?.focus();
    previousFocus = null;
  }

  watch(
    open,
    async (isOpen) => {
      if (!isOpen) {
        deactivate(true);
        return;
      }

      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      background = document.querySelector<HTMLElement>("#app");
      document.addEventListener("keydown", handleKeydown, true);
      await nextTick();
      if (!open()) return;
      const firstInput = container.value?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      );
      (initialFocus?.() ?? firstInput ?? focusableElements()[0] ?? container.value)?.focus();
      if (background) {
        background.inert = true;
        background.setAttribute("aria-hidden", "true");
      }
    },
    { flush: "post", immediate: true },
  );

  onBeforeUnmount(() => deactivate(true));
}
