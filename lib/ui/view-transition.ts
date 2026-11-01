/**
 * Browsers abort a view transition when the tab is hidden. The page still updates; only the
 * animation is skipped. React ignores that abort, but only for the exact message
 * "Transition was aborted because of invalid state" — newer Chromium appends ". Document hidden",
 * so React reports it as a recoverable error. This runs in <head>, before React loads, and:
 *  1. doesn't start a transition in a hidden tab (React then just applies the update),
 *  2. trims the abort message back to the one React recognizes,
 *  3. keeps the remaining harmless rejections out of the Next.js error overlay.
 */
export const VIEW_TRANSITION_GUARD = `(function(){
var BASE="Transition was aborted because of invalid state";
function benign(r){return r&&(r.name==="InvalidStateError"||r.name==="AbortError")&&/transition was (aborted|skipped)|view transition/i.test(String(r.message))}
var P=Document.prototype,orig=P.startViewTransition;
if(orig){P.startViewTransition=function(a){
if(document.hidden)throw new DOMException(BASE,"InvalidStateError");
var t=orig.call(this,a);
function fix(p){return p.catch(function(e){if(e&&e.name==="InvalidStateError"&&String(e.message).indexOf(BASE)===0)throw new DOMException(BASE,"InvalidStateError");throw e})}
var ready=fix(t.ready),finished=fix(t.finished);
return new Proxy(t,{get:function(o,k){if(k==="ready")return ready;if(k==="finished")return finished;var v=o[k];return typeof v==="function"?v.bind(o):v}});
}}
function stop(e){e.preventDefault();e.stopImmediatePropagation()}
addEventListener("unhandledrejection",function(e){if(benign(e.reason))stop(e)},true);
addEventListener("error",function(e){if(benign(e.error))stop(e)},true);
})();`;
