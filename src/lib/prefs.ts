// Look-and-feel preferences kept on <html data-*> (read by CSS) and mirrored in
// localStorage. An inline script in the root layout applies them before paint.
export type Theme = "dark" | "light";
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
  setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
}

export function toggleNavMode(): void {
  setNavMode(document.documentElement.dataset.nav === "rail" ? "full" : "rail");
}

export const PREFS_SCRIPT = `try{var d=document.documentElement,s=localStorage;if(s.getItem('apostas:theme')==='light')d.dataset.theme='light';if(s.getItem('apostas:nav')==='rail')d.dataset.nav='rail'}catch(e){}`;
