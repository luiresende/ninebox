// ============================================================================
// STORE: camada de persistência + autenticação
// ----------------------------------------------------------------------------
// Decide automaticamente entre:
//   - MODO FIREBASE: Authentication (e-mail/senha) + Firestore, quando o
//                    firebase-config.js tem credenciais reais e o SDK carregou.
//   - MODO LOCAL   : localStorage, apenas como fallback de desenvolvimento
//                    (sem credenciais / SDK ausente). Sem login nem papéis.
//
// Papéis:
//   - LÍDER      : e-mail está em LEADER_EMAILS. Lê e escreve TODOS os docs.
//   - COLABORADOR: lê somente o doc cujo ID == o próprio e-mail (sua avaliação).
//
// IMPORTANTE: a lista abaixo é só pra UI decidir o que mostrar. A segurança de
// verdade está nas Firestore Security Rules (firestore.rules), no servidor.
// Mantenha as duas listas em sincronia.
// ============================================================================

(function () {
  // --- Líderes (também replicado em firestore.rules) ------------------------
  const LEADER_EMAILS = ['lcalmeida4@stefanini.com'];

  const LS_KEY = 'avaliacao.members.v1';

  function norm(email) {
    return (email || '').trim().toLowerCase();
  }

  function isLeaderEmail(email) {
    return LEADER_EMAILS.map(norm).includes(norm(email));
  }

  function configLooksReal(cfg) {
    if (!cfg) return false;
    return Object.values(cfg).every(
      (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('COLE_AQUI_')
    );
  }

  const useFirebase =
    configLooksReal(window.FIREBASE_CONFIG) && typeof window.firebase !== 'undefined';

  // id de documento = e-mail normalizado (decisão de modelagem acordada)
  function emailToId(email) {
    return norm(email);
  }

  // ==========================================================================
  //  MODO LOCAL (fallback de desenvolvimento, sem login)
  // ==========================================================================
  const LocalStore = {
    mode: 'local',
    role: 'leader', // sem login, trata como líder para permitir testar tudo
    currentUser: { email: 'local@dev', isLeader: true },
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
    isLeader() {
      return true;
    },
    onAuth(cb) {
      // sem login: dispara já autenticado como líder local
      cb(this.currentUser);
      return () => {};
    },
    async login() {
      throw new Error('Login indisponível em modo local.');
    },
    async logout() {},
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

  // ==========================================================================
  //  MODO FIREBASE (Auth e-mail/senha + Firestore)
  // ==========================================================================
  function makeFirebaseStore() {
    firebase.initializeApp(window.FIREBASE_CONFIG);
    const auth = firebase.auth();
    const db = firebase.firestore();
    const col = db.collection('members');

    // mantém login entre reloads
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

    let current = null; // { email, isLeader }

    const store = {
      mode: 'firebase',
      get currentUser() {
        return current;
      },
      isLeader() {
        return !!current && current.isLeader;
      },

      // Observa mudanças de login. Chama cb(user|null).
      onAuth(cb) {
        return auth.onAuthStateChanged((fbUser) => {
          if (fbUser) {
            current = {
              uid: fbUser.uid,
              email: norm(fbUser.email),
              isLeader: isLeaderEmail(fbUser.email),
            };
          } else {
            current = null;
          }
          cb(current);
        });
      },

      async login(email, password) {
        await auth.signInWithEmailAndPassword(norm(email), password);
      },

      async logout() {
        await auth.signOut();
      },

      // Lista conforme o papel:
      //  - líder: todos os docs (necessário para radares, média do time e Nine Box)
      //  - colaborador: apenas o próprio doc
      async list() {
        if (!current) return [];
        if (current.isLeader) {
          const snap = await col.get();
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        const doc = await col.doc(emailToId(current.email)).get();
        return doc.exists ? [{ id: doc.id, ...doc.data() }] : [];
      },

      async save(member) {
        await col.doc(member.id).set(member, { merge: true });
        return member;
      },

      async remove(id) {
        await col.doc(id).delete();
      },
    };

    return store;
  }

  window.Store = useFirebase ? makeFirebaseStore() : LocalStore;

  // helpers expostos
  window.Store.isLeaderEmail = isLeaderEmail;
  window.Store.emailToId = emailToId;
  window.Store.normEmail = norm;
})();
