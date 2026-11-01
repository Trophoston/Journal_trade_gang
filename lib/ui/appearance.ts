export type ThemePref = "system" | "light" | "dark";
export type GlassLevel = "most" | "mid" | "none";
export type MotionPref = "system" | "full" | "reduced" | "off";
export type PalettePref = "default" | "cb";

export interface Appearance {
  theme: ThemePref;
  glass: GlassLevel;
  motion: MotionPref;
  palette: PalettePref;
}

export const APPEARANCE_KEY = "tg-appearance";
export const DEFAULT_APPEARANCE: Appearance = { theme: "system", glass: "most", motion: "system", palette: "default" };

/**
 * Runs before first paint (inline in <head>): applies the saved theme, glass,
 * motion and palette to <html> so nothing flashes. Also marks the one-time
 * bento intro as seen for this browser session.
 */
export const APPEARANCE_SCRIPT = `(function(){try{var d=document.documentElement,a=${JSON.stringify(DEFAULT_APPEARANCE)};try{var s=JSON.parse(localStorage.getItem("${APPEARANCE_KEY}")||"{}");for(var k in s)a[k]=s[k]}catch(e){}var dark=a.theme==="dark"||(a.theme==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);d.classList.toggle("dark",dark);d.dataset.glass=a.glass;if(localStorage.getItem("${APPEARANCE_KEY}"))d.dataset.glassUser="1";if(a.motion!=="system")d.dataset.motion=a.motion;else delete d.dataset.motion;d.dataset.palette=a.palette;if(sessionStorage.getItem("tg-intro"))d.dataset.intro="done";else{sessionStorage.setItem("tg-intro","1");setTimeout(function(){d.dataset.intro="done"},2400)}}catch(e){}})();`;
