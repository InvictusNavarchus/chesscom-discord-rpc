export function getElementText(el: Element | null): string {
  if (!el) return '';
  if (el instanceof HTMLElement) return el.innerText.trim();
  return (el.textContent || '').trim();
}
