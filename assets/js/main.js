// main.js
// Top-page login modal + Firebase email/password auth (index.html)

// Dynamically load Firebase compat SDKs and optional local config at /assets/js/firebase-config.js
function loadScript(src){
	return new Promise((resolve, reject)=>{
		const s = document.createElement('script');
		s.src = src;
		s.async = true;
		s.onload = ()=>resolve(s);
		s.onerror = (e)=>reject(new Error('Failed to load '+src));
		document.head.appendChild(s);
	});
}

async function tryInitFirebase(){
	// If firebase is already present or the shared initializer ran, assume initialized
	if(typeof window.firebase !== 'undefined' || window.__FIREBASE_INITIALIZED__) return true;
	try{
		// Prefer the centralized initializer `firebase-init.js` so SDK loading is single-sourced.
		// Attempt to load the shared initializer if it's not already present.
		if(!document.querySelector('script[src="/assets/js/firebase-init.js"]')){
			try{ await loadScript('/assets/js/firebase-init.js'); }catch(_){}
		}
		// Wait briefly for firebase-init to initialize Firebase
		const start = Date.now();
		while(Date.now() - start < 1500){
			if(window.__FIREBASE_INITIALIZED__ || typeof window.firebase !== 'undefined') break;
			await new Promise(r => setTimeout(r, 50));
		}
		if(typeof window.firebase !== 'undefined'){ console.debug('Firebase available after firebase-init:', !!window.FIREBASE_CONFIG); return true; }
	}catch(e){ console.warn('Error while trying to initialize firebase via firebase-init', e); }
	// If we reach here, firebase is not initialized and we do NOT attempt to load SDKs here anymore.
	return false;
}

document.addEventListener('DOMContentLoaded', async ()=>{
	// attempt background init; main auth handlers will still check for window.firebase
	tryInitFirebase().then(ok=>{
		if(!ok) console.info('Firebase not initialized. To enable auth, create /assets/js/firebase-config.js based on assets/js/firebase-config.example.js');
	});
	const btn = document.getElementById('topBtnSignIn');
	const modal = document.getElementById('loginModal');
	const btnClose = document.getElementById('topBtnClose');
	const btnLogin = document.getElementById('topBtnLogin');
	const btnRegister = document.getElementById('topBtnRegister');
	const statusEl = document.getElementById('topLoginStatus');
	const emailEl = document.getElementById('topAuthEmail');
	const passEl = document.getElementById('topAuthPassword');

	function showModal(){ if(modal){ modal.setAttribute('aria-hidden','false'); } }
	function hideModal(){ if(modal){ modal.setAttribute('aria-hidden','true'); } }

	btn?.addEventListener('click', (e)=>{ e.preventDefault(); showModal(); if(emailEl) emailEl.focus(); });
	btnClose?.addEventListener('click', (e)=>{ e.preventDefault(); hideModal(); });

	async function trySignIn(){
		const email = emailEl && emailEl.value && emailEl.value.trim();
		const password = passEl && passEl.value || '';
		if(!email || !password){ alert('メールとパスワードを入力してください'); return; }
		// Ensure Firebase SDKs/config are loaded before attempting sign-in
		const ok = await tryInitFirebase();
		if(!ok || typeof window.firebase === 'undefined' || !window.firebase.auth){ alert('Firebase が読み込まれていません。設定してください。'); return; }
		try{
			// Ensure persistence so auth state survives page reloads
			try{ await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL); }catch(e){ console.warn('setPersistence failed', e); }
			await firebase.auth().signInWithEmailAndPassword(email, password);
			statusEl && (statusEl.textContent = 'サインインに成功しました');
			// Diagnostic: log current auth state and firebase config
			try{ console.debug('main.js: signIn success, firebase.apps.length=', (firebase.apps && firebase.apps.length) || 0, 'currentUser=', firebase.auth().currentUser, 'FIREBASE_CONFIG=', window.FIREBASE_CONFIG || window.__FIREBASE_CONFIG__); }catch(_){ }
			hideModal();
		}catch(err){ alert('サインイン失敗: '+(err && err.message || err)); }
	}

	async function tryRegister(){
		const email = emailEl && emailEl.value && emailEl.value.trim();
		const password = passEl && passEl.value || '';
		if(!email || !password){ alert('メールとパスワードを入力してください'); return; }
		// Ensure Firebase SDKs/config are loaded before attempting registration
		const ok = await tryInitFirebase();
		if(!ok || typeof window.firebase === 'undefined' || !window.firebase.auth){ alert('Firebase が読み込まれていません。設定してください。'); return; }
		try{
			// Ensure persistence so auth state survives page reloads
			try{ await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL); }catch(e){ console.warn('setPersistence failed', e); }
			await firebase.auth().createUserWithEmailAndPassword(email, password);
			statusEl && (statusEl.textContent = 'アカウント作成とログインに成功しました');
			try{ console.debug('main.js: createUser success, firebase.apps.length=', (firebase.apps && firebase.apps.length) || 0, 'currentUser=', firebase.auth().currentUser); }catch(_){ }
			hideModal();
		}catch(err){ alert('登録失敗: '+(err && err.message || err)); }
	}

	btnLogin?.addEventListener('click', (e)=>{ e.preventDefault(); trySignIn(); });
	btnRegister?.addEventListener('click', (e)=>{ e.preventDefault(); tryRegister(); });

	// Optional: update UI on auth state change
	if(typeof window.firebase !== 'undefined' && window.firebase.auth){
		function updateLoginUI(isSignedIn){
			try{ localStorage.setItem('signedIn', isSignedIn ? '1' : '0'); }catch(e){}
			if(!btn) return;
			if(isSignedIn){
				// Show logged-in state text
				btn.textContent = 'ログイン済み';
				// Remove modal-opening behavior while signed in
				try{ btn.removeEventListener('click', showModal); }catch(e){}
			} else {
				btn.textContent = 'ログイン';
				// restore modal opener
				try{ btn.addEventListener('click', (e)=>{ e.preventDefault(); showModal(); if(emailEl) emailEl.focus(); }); }catch(e){}
			}
		}

		firebase.auth().onAuthStateChanged(user => {
			if(user){
				updateLoginUI(true);
			} else {
				updateLoginUI(false);
			}
		});
	} else {
		// No Firebase: restore UI from localStorage (simple fallback)
		try{
			const val = localStorage.getItem('signedIn');
			if(val === '1'){
				btn && (btn.textContent = 'ログイン済み');
			} else {
				btn && (btn.textContent = 'ログイン');
			}
		}catch(e){}
	}

	// --- Diagnostic: top-actions visibility helper (logging only) ---
	try{
		const ta = document.querySelector('.top-actions');
		if(ta){
			const cs = window.getComputedStyle(ta);
			console.log('DEBUG: .top-actions computed style', {
				display: cs.display,
				visibility: cs.visibility,
				opacity: cs.opacity,
				transform: cs.transform,
				zIndex: cs.zIndex,
				position: cs.position,
				top: cs.top,
				right: cs.right,
				boundingClientRect: ta.getBoundingClientRect()
			});
		} else {
			console.warn('DEBUG: .top-actions element not found in DOM');
		}
	} catch(e){ console.warn('DEBUG: error while running top-actions diagnostic', e); }

	// Settings button: provide data wipe (local tasks/daily + remote Firestore doc)
	try{
		const settingsBtn = document.getElementById('topBtnSettings');
		if(settingsBtn){
			settingsBtn.addEventListener('click', async (ev)=>{
				ev.preventDefault();
				const ok = confirm('注意: データを完全に削除します。ローカルの記録と（サインイン中の場合）リモートの履歴も削除されます。よろしいですか？');
				if(!ok) return;
				try{
					// try to stop session if function exists
					try{ if(typeof performReset === 'function') performReset(); }catch(e){}
					// remove app data keys: tasks:, daily:, cum_base, last_date, favTargets, pushSubscription
					const delKeys = [];
					for(let i=0;i<localStorage.length;i++){ const k = localStorage.key(i); if(!k) continue; if(k.startsWith('tasks:') || k.startsWith('daily:') ) delKeys.push(k); }
					['cum_base','last_date', 'pushSubscription', 'favTargets:v1'].forEach(k=>{ if(localStorage.getItem(k)!==null) delKeys.push(k); });
					delKeys.forEach(k=>{ try{ localStorage.removeItem(k); }catch(e){} });
					// If signed in, also delete remote Firestore doc
					try{
						if(window.firebase && firebase.auth && firebase.auth().currentUser && firebase.firestore){
							const uid = firebase.auth().currentUser.uid;
							try{ await firebase.firestore().collection('users').doc(uid).delete(); console.debug('Settings: remote user doc deleted for', uid); }catch(e){ console.warn('Settings: failed to delete remote doc', e); }
						}
					}catch(e){ console.warn('Settings: remote delete check failed', e); }
					// Re-render UI and notify
					try{ if(typeof renderAll === 'function') try{ renderAll(); }catch(e){} }catch(e){}
					alert('データを削除しました');
					try{ if(window.firebase && firebase.auth && firebase.auth().currentUser){ await firebase.auth().signOut(); } }catch(e){ /* ignore */ }
					window.location.reload();
				}catch(e){ console.error('wipe failed', e); alert('データ削除に失敗しました。Console を確認してください。'); }
			});
		}
	}catch(e){ console.warn('settings hook failed', e); }
});
