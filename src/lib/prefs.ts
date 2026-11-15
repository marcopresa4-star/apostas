// Look-and-feel preferences kept on <html data-*> (read by CSS) and mirrored in
// localStorage. An inline script in the root layout applies them before paint.
export type Theme = "dark" | "light" | "natal";

// Cycle order of the theme button.
const THEME_ORDER: Theme[] = ["dark", "light", "natal"];
export type NavMode = "full" | "rail";

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    window.localStorage.setItem("apostas:theme", t);
  } catch {
    // Private mode: just not remembered.
  }
}

export function setNavMode(m: NavMode): void {
  document.documentElement.dataset.nav = m;
  try {
    window.localStorage.setItem("apostas:nav", m);
  } catch {
    // Private mode: just not remembered.
  }
}

export function toggleTheme(): void {
  const cur = document.documentElement.dataset.theme as Theme | undefined;
  const i = THEME_ORDER.indexOf(cur ?? "dark");
  setTheme(THEME_ORDER[(i + 1) % THEME_ORDER.length]);
}

export function toggleNavMode(): void {
  setNavMode(document.documentElement.dataset.nav === "rail" ? "full" : "rail");
}

export const PREFS_SCRIPT = `try{var d=document.documentElement,s=localStorage;var t=s.getItem('apostas:theme');if(t==='light'||t==='natal')d.dataset.theme=t;if(s.getItem('apostas:nav')==='rail')d.dataset.nav='rail'}catch(e){}`;
