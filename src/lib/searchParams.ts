// A parameter of the address can come once, repeated, or not at all.
export function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// Today as YYYY-MM-DD, by the local clock.
export function todayISO(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Every value of a parameter that can come more than once (checkboxes).
export function list(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
}
