/**
 * Scrap App Premium Y2K Dialog Modals
 * Replaces standard browser alert(), confirm(), and prompt() dialogs
 * to prevent showing browser URLs (like http://localhost) in native webviews.
 */

window.ScrapDialog = {
  sanitizeErrorMessage(msg) {
    if (!msg) return 'An unexpected error occurred. Please try again.';
    const str = String(msg);

    if (str.includes('github.com/pocketbase') || str.includes('ClientResponseError') || str.includes('Failed to fetch') || str.includes('NetworkError')) {
      return '📡 Connection interrupted. Please check your internet connection and try again.';
    }
    if (str.includes('400') && str.includes('Something went wrong')) {
      return '📡 Connection interrupted. Please check your internet connection and try again.';
    }
    if (str.includes('404') && (str.includes('not_found') || str.includes('ClientResponseError'))) {
      return '⚠️ Item or room could not be found. It may have been updated or removed.';
    }
    if (str.includes('403') || str.includes('forbidden') || str.includes('unauthorized')) {
      return '🔒 Session expired or unauthorized. Please re-enter the room.';
    }

    return str;
  },

  alert(message) {
    const cleanMessage = this.sanitizeErrorMessage(message);
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 999999 !important; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 16px;';
      modal.innerHTML = `
        <div style="background:#120921; border:1px solid rgba(57,255,20,0.3); border-radius:24px; padding:24px; width:100%; max-width:360px; text-center; box-shadow:0 20px 40px rgba(0,0,0,0.8);" class="animate-in fade-in zoom-in-95 duration-200">
          <p style="color:#fff; font-family:monospace; font-size:13px; line-height:1.6; margin-bottom:24px; text-transform:uppercase; letter-spacing:1px;">${cleanMessage}</p>
          <button style="background:#39ff14; color:#000; font-family:monospace; font-weight:bold; font-size:11px; padding:10px 24px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; cursor:pointer; transition:transform 0.1s;" class="hover:scale-105 active:scale-95">OK</button>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector('button').addEventListener('click', () => {
        modal.remove();
        resolve();
      });
    });
  },

  confirm(message) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 999999 !important; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 16px;';
      modal.innerHTML = `
        <div style="background:#120921; border:1px solid rgba(255,0,171,0.3); border-radius:24px; padding:24px; width:100%; max-width:360px; text-center; box-shadow:0 20px 40px rgba(0,0,0,0.8);" class="animate-in fade-in zoom-in-95 duration-200">
          <p style="color:#fff; font-family:monospace; font-size:13px; line-height:1.6; margin-bottom:24px; text-transform:uppercase; letter-spacing:1px;">${message}</p>
          <div style="display:flex; justify-content:center; gap:16px;">
            <button id="dlg-btn-cancel" style="background:rgba(255,255,255,0.08); color:#fff; font-family:monospace; font-size:11px; padding:10px 24px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; cursor:pointer;" class="active:scale-95">Cancel</button>
            <button id="dlg-btn-ok" style="background:#ff00ab; color:#fff; font-family:monospace; font-weight:bold; font-size:11px; padding:10px 24px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; cursor:pointer;" class="active:scale-95">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector('#dlg-btn-cancel').addEventListener('click', () => {
        modal.remove();
        resolve(false);
      });
      modal.querySelector('#dlg-btn-ok').addEventListener('click', () => {
        modal.remove();
        resolve(true);
      });
    });
  },

  prompt(message, defaultValue = '') {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 999999 !important; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 16px;';
      modal.innerHTML = `
        <div style="background:#120921; border:1px solid rgba(0,240,255,0.3); border-radius:24px; padding:24px; width:100%; max-width:360px; text-center; box-shadow:0 20px 40px rgba(0,0,0,0.8);" class="animate-in fade-in zoom-in-95 duration-200">
          <p style="color:#fff; font-family:monospace; font-size:13px; line-height:1.6; margin-bottom:16px; text-transform:uppercase; letter-spacing:1px;">${message}</p>
          <input type="text" value="${defaultValue}" style="width:100%; box-sizing:border-box; padding:10px 16px; margin-bottom:24px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); border-radius:12px; color:#fff; font-family:monospace; font-size:13px; text-align:center; outline:none;" id="dlg-prompt-input" />
          <div style="display:flex; justify-content:center; gap:16px;">
            <button id="dlg-btn-cancel" style="background:rgba(255,255,255,0.08); color:#fff; font-family:monospace; font-size:11px; padding:10px 24px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; cursor:pointer;" class="active:scale-95">Cancel</button>
            <button id="dlg-btn-ok" style="background:#00f0ff; color:#000; font-family:monospace; font-weight:bold; font-size:11px; padding:10px 24px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; cursor:pointer;" class="active:scale-95">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const input = modal.querySelector('#dlg-prompt-input');
      input.focus();
      input.select();

      const checkAndResolve = (val) => {
        if (window.ScrapSafety && !window.ScrapSafety.checkTextSafety(val)) {
          window.ScrapDialog.alert('⚠️ Safety Guideline Violation:\nThis content contains words associated with illegal or harmful activities. Please keep our squad space safe!');
          return;
        }
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
          window.Capacitor.Plugins.Keyboard.hide().catch(() => {});
        }
        input.disabled = true; // Disable to force native keyboard close in WebView
        input.blur();
        modal.remove();
        resolve(val);
      };

      modal.querySelector('#dlg-btn-cancel').addEventListener('click', () => {
        if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard) {
          window.Capacitor.Plugins.Keyboard.hide().catch(() => {});
        }
        input.disabled = true; // Disable to force native keyboard close in WebView
        input.blur();
        modal.remove();
        resolve(null);
      });
      modal.querySelector('#dlg-btn-ok').addEventListener('click', () => {
        checkAndResolve(input.value);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          checkAndResolve(input.value);
        }
      });
    });
  },

  showOptions(message, options = []) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.style.cssText = 'position: fixed; inset: 0; z-index: 999999 !important; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.8); padding: 16px;';
      
      let buttonsHtml = '';
      options.forEach((opt, idx) => {
        buttonsHtml += `
          <button data-index="${idx}" style="width:100%; margin-bottom:10px; background:#00ffcc; color:#000; font-family:monospace; font-weight:bold; font-size:11px; padding:12px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; cursor:pointer;" class="active:scale-95 hover:scale-[1.02] transition-transform">${opt}</button>
        `;
      });
      buttonsHtml += `
        <button id="dlg-btn-cancel" style="width:100%; background:rgba(255,255,255,0.08); color:#fff; font-family:monospace; font-size:11px; padding:12px; border:none; border-radius:99px; text-transform:uppercase; letter-spacing:2px; cursor:pointer;" class="active:scale-95">Cancel</button>
      `;

      modal.innerHTML = `
        <div style="background:#120921; border:1px solid rgba(0,255,204,0.3); border-radius:24px; padding:24px; width:100%; max-width:340px; max-height:85vh; overflow-y:auto; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.8);" class="animate-in fade-in zoom-in-95 duration-200">
          <p style="color:#fff; font-family:monospace; font-size:12px; line-height:1.6; margin-bottom:20px; text-transform:uppercase; letter-spacing:1px; font-weight:bold;">${message}</p>
          <div style="display:flex; flex-direction:column; gap:4px;">
            ${buttonsHtml}
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelectorAll('button[data-index]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-index'));
          modal.remove();
          resolve(idx);
        });
      });

      modal.querySelector('#dlg-btn-cancel').addEventListener('click', () => {
        modal.remove();
        resolve(null);
      });
    });
  }
};
