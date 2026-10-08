// ============================================================================
// STORE: camada de persistência
// ----------------------------------------------------------------------------
// Decide automaticamente entre:
//   - MODO LOCAL  : salva no localStorage (quando o firebase-config.js ainda
//                   está com os valores "COLE_AQUI_...").
//   - MODO FIREBASE: usa o Firestore (quando as credenciais forem preenchidas).
//
// A API pública é a mesma nos dois modos (Promises), então o app.js não precisa
// saber qual está ativo.
// ============================================================================

(function () {
  const LS_KEY = 'avaliacao.members.v1';

  function configLooksReal(cfg) {
    if (!cfg) return false;
    return Object.values(cfg).every(
      (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('COLE_AQUI_')
    );
  }

  const useFirebase =
    configLooksReal(window.FIREBASE_CONFIG) && typeof window.firebase !== 'undefined';

  // --------------------------- MODO LOCAL -----------------------------------
  const LocalStore = {
    mode: 'local',
    _read() {
      try {
        return JSON.parse(localStorage.getItem(LS_KEY)) || [];
      } catch {
        return [];
      }
    },
    _write(members) {
      localStorage.setItem(LS_KEY, JSON.stringify(members));
    },
    async list() {
      return this._read();
    },
    async save(member) {
      const members = this._read();
      const idx = members.findIndex((m) => m.id === member.id);
      if (idx >= 0) members[idx] = member;
      else members.push(member);
      this._write(members);
      return member;
    },
    async remove(id) {
      this._write(this._read().filter((m) => m.id !== id));
    },
  };

  // -------------------------- MODO FIREBASE ---------------------------------
  // Implementação mínima usando o SDK compat (carregado por quem ativar o
  // Firebase). Mantém a mesma assinatura do LocalStore.
  function makeFirebaseStore() {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    const db = firebase.firestore();
    const col = db.collection('members');
    return {
      mode: 'firebase',
      async list() {
        const snap = await col.get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      },
      async save(member) {
        await col.doc(member.id).set(member, { merge: true });
        return member;
      },
      async remove(id) {
        await col.doc(id).delete();
      },
    };
  }

  window.Store = useFirebase ? makeFirebaseStore() : LocalStore;

  // id simples e único o suficiente para esse contexto
  window.Store.newId = function () {
    return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };
})();
