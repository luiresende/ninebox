// ============================================================================
// STORE: camada de persistência + autenticação
// ----------------------------------------------------------------------------
// Decide automaticamente entre:
//   - MODO FIREBASE: Authentication (e-mail/senha) + Firestore, quando o
//                    firebase-config.js tem credenciais reais e o SDK carregou.
//   - MODO LOCAL   : localStorage, apenas como fallback de desenvolvimento
//                    (sem credenciais / SDK ausente). Sem login nem papéis.
//
// Papéis (agora guardados no Firestore, coleção "roles"):
//   - LÍDER      : e-mail em BOOTSTRAP_LEADERS OU roles/{email}.role=='leader'.
//                  Lê e escreve TODOS os docs e gerencia papéis.
//   - COLABORADOR: lê somente o próprio members/{email} (sua avaliação).
//
// O papel vem do servidor. A segurança real está nas Firestore Security Rules
// (firestore.rules). Mantenha BOOTSTRAP_LEADERS em sincronia com bootstrap() lá.
// ============================================================================

(function () {
  // --- Líder(es) semeado(s) — replicado em firestore.rules bootstrap() ------
  // Resolve o ovo-e-galinha: sem isso ninguém poderia criar o primeiro papel.
  const BOOTSTRAP_LEADERS = ['lcalmeida4@stefanini.com'];

  const LS_KEY = 'avaliacao.members.v1';

  function norm(email) {
    return (email || '').trim().toLowerCase();
  }

  function isBootstrapLeader(email) {
    return BOOTSTRAP_LEADERS.map(norm).includes(norm(email));
  }

  function configLooksReal(cfg) {
    if (!cfg) return false;
    return Object.values(cfg).every(
      (v) => typeof v === 'string' && v.length > 0 && !v.startsWith('COLE_AQUI_')
    );
  }

  const configOk = configLooksReal(window.FIREBASE_CONFIG);
  const sdkOk = typeof window.firebase !== 'undefined';
  const useFirebase = configOk && sdkOk;

  // Diagnóstico: deixa claro no console por que o modo foi escolhido.
  console.log(
    '[Store] config real?', configOk,
    '| SDK Firebase carregado?', sdkOk,
    '| modo =', useFirebase ? 'FIREBASE' : 'LOCAL'
  );
  if (configOk && !sdkOk) {
    console.error(
      '[Store] A config do Firebase está preenchida, mas o SDK (window.firebase) ' +
      'NÃO carregou. Provável bloqueio de rede ao baixar os scripts de ' +
      'https://www.gstatic.com/firebasejs/... ou os <script> não vieram antes de store.js.'
    );
  }

  // Diagnóstico VISÍVEL na tela (independe do DevTools/F12, que pode estar
  // bloqueado em rede corporativa). Mostra uma faixa no topo quando a config
  // está certa mas o SDK não carregou.
  window.STORE_DIAG = { configOk, sdkOk, useFirebase };
  if (configOk && !sdkOk) {
    window.addEventListener('DOMContentLoaded', function () {
      var bar = document.createElement('div');
      bar.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:9999;background:#dc2626;color:#fff;' +
        'padding:12px 16px;font:13px/1.4 Segoe UI,sans-serif;text-align:center';
      bar.textContent =
        'Firebase não carregou (SDK bloqueado pela rede). O app está em modo local. ' +
        'Os scripts de gstatic.com/firebasejs foram bloqueados pelo navegador/proxy.';
      document.body.appendChild(bar);
    });
  }

  // id de documento = e-mail normalizado (decisão de modelagem acordada)
  function emailToId(email) {
    return norm(email);
  }

  // --- Período trimestral ----------------------------------------------------
  // Chave de período no formato 'YYYY-Qn' (Q1=Jan-Mar, Q2=Abr-Jun,
  // Q3=Jul-Set, Q4=Out-Dez). Usada para separar as avaliações por trimestre.
  function periodKeyFor(date) {
    const d = date instanceof Date ? date : new Date();
    return d.getFullYear() + '-Q' + (Math.floor(d.getMonth() / 3) + 1);
  }

  // Chave do trimestre atual (baseada na data de hoje).
  function currentPeriodKey() {
    return periodKeyFor(new Date());
  }

  // --- Limpeza do pilar HardSkill (contrato) ---------------------------------
  // clearHardSkill(member) ZERA o pilar HardSkill do membro, removendo a chave
  // 'hard' das notas de CADA período (member.periods[k].scores.hard) e também
  // o legado de raiz member.scores.hard, caso exista. Características:
  //   - IDEMPOTENTE: aplicar N vezes produz o mesmo resultado (o delete de uma
  //     chave inexistente é inócuo); nunca lança exceção por 'hard' ausente.
  //   - NÃO DESTRUTIVA: preserva scores.soft, scores.discipline e plan em TODOS
  //     os períodos (e o plan/soft/discipline de raiz, se houver). Só mexe em
  //     'hard'.
  //   - Mutação IN PLACE: altera o próprio objeto recebido e o devolve.
  // Motivo: a troca para HardSkill por família de cargo invalida as notas de
  // HardSkill antigas (os eixos passam a depender do cargo), então o pilar é
  // zerado uma única vez na migração (ver migrateOnRead + flag hardMigratedV1).
  function clearHardSkill(member) {
    if (!member) return member;
    if (member.periods && typeof member.periods === 'object') {
      Object.keys(member.periods).forEach((k) => {
        const p = member.periods[k];
        if (p && p.scores && Object.prototype.hasOwnProperty.call(p.scores, 'hard')) {
          delete p.scores.hard; // preserva soft/discipline em p.scores e p.plan
        }
      });
    }
    // legado de raiz: alguns membros antigos guardam scores na raiz do doc
    if (member.scores && Object.prototype.hasOwnProperty.call(member.scores, 'hard')) {
      delete member.scores.hard;
    }
    return member;
  }

  // --- Migração preguiçosa e NÃO destrutiva (contrato) -----------------------
  // Membros legados guardam { scores, plan } na raiz do doc. Para suportar
  // avaliação trimestral passamos a guardar member.periods['YYYY-Qn'] =
  // { scores, plan }. Esta migração acontece "on read": quando um membro ainda
  // não tem .periods, criamos periods[trimestreAtual] copiando os campos de
  // raiz. Características do contrato:
  //   - IDEMPOTENTE: se member.periods já existe, o membro é devolvido intacto.
  //   - NÃO DESTRUTIVA em leitura: os campos legados scores/plan da raiz NÃO
  //     são apagados aqui (seguro em leituras puras). A remoção dos campos de
  //     raiz só ocorre na gravação (ver prepareForWrite).
  //   - Mutação IN PLACE: o próprio objeto recebido ganha .periods, de modo que
  //     o membro em memória no app.js também passa a enxergar os períodos.
  function migrateOnRead(member) {
    if (!member) return member;
    if (!member.periods) {
      member.periods = {};
      member.periods[currentPeriodKey()] = {
        scores: member.scores || {},
        plan: member.plan || [],
      };
    }
    // Migração do HardSkill por família de cargo: zera o pilar HardSkill UMA
    // ÚNICA VEZ por membro, controlada pelo flag PERSISTENTE hardMigratedV1.
    // Como o flag faz parte do próprio member, ele é gravado no doc
    // (ver prepareForWrite) e, em leituras futuras, impede re-zerar notas de
    // HardSkill que o usuário tenha inserido APÓS a migração.
    if (member.hardMigratedV1 !== true) {
      clearHardSkill(member);
      member.hardMigratedV1 = true;
    }
    return member;
  }

  // Prepara o payload de gravação a partir de um membro já migrado.
  // Como o save do Firebase usa { merge:true }, campos de raiz obsoletos
  // (scores/plan) precisam ser explicitamente removidos com
  // firebase.firestore.FieldValue.delete(); no modo local basta omiti-los.
  function prepareForWrite(member, mode) {
    migrateOnRead(member);
    // Object.assign copia TODOS os campos do membro, incluindo o flag
    // persistente hardMigratedV1, de modo que ele é gravado no doc. O objeto
    // periods também é copiado por referência e gravado inteiro (o merge
    // sobrescreve a chave 'periods'), então o scores.hard já removido por
    // clearHardSkill persiste naturalmente — nenhum caminho reintroduz 'hard'.
    const payload = Object.assign({}, member);
    if (mode === 'firebase') {
      payload.scores = firebase.firestore.FieldValue.delete();
      payload.plan = firebase.firestore.FieldValue.delete();
    } else {
      delete payload.scores;
      delete payload.plan;
    }
    return payload;
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
    async signup() {
      throw new Error('Cadastro indisponível em modo local.');
    },
    async logout() {},
    async list() {
      // migração preguiçosa: cada membro lido ganha .periods se ainda não tiver
      return this._read().map(migrateOnRead);
    },
    async save(member) {
      // migra em memória (member ganha .periods) e grava a versão sem os
      // campos legados de raiz (scores/plan) — ver prepareForWrite.
      const payload = prepareForWrite(member, 'local');
      const members = this._read();
      const idx = members.findIndex((m) => m.id === payload.id);
      if (idx >= 0) members[idx] = payload;
      else members.push(payload);
      this._write(members);
      return member;
    },
    async remove(id) {
      this._write(this._read().filter((m) => m.id !== id));
    },
    // Gestão de papéis não se aplica ao modo local (sem Firestore).
    async listRoles() {
      return [];
    },
    async setRole() {},
    async removeRole() {},
    // cargos adicionais no modo local ficam no localStorage
    async listCargos() {
      try {
        return JSON.parse(localStorage.getItem('avaliacao.cargos.v1')) || [];
      } catch {
        return [];
      }
    },
    async addCargo(name) {
      const nm = (name || '').trim();
      if (!nm) return;
      const list = await this.listCargos();
      if (!list.includes(nm)) {
        list.push(nm);
        localStorage.setItem('avaliacao.cargos.v1', JSON.stringify(list));
      }
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
    const rolesCol = db.collection('roles');
    const cargosCol = db.collection('cargos');

    // mantém login entre reloads
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

    let current = null; // { uid, email, isLeader }

    // Resolve o papel do usuário: bootstrap OU doc em roles/{email}.
    // Default (sem doc e fora do bootstrap) = colaborador.
    async function resolveIsLeader(email) {
      if (isBootstrapLeader(email)) return true;
      try {
        const doc = await rolesCol.doc(emailToId(email)).get();
        return doc.exists && doc.data().role === 'leader';
      } catch (e) {
        // sem permissão/erro de leitura -> trata como colaborador (seguro)
        return false;
      }
    }

    const store = {
      mode: 'firebase',
      get currentUser() {
        return current;
      },
      isLeader() {
        return !!current && current.isLeader;
      },

      // Observa mudanças de login. Chama cb(user|null) APÓS resolver o papel.
      onAuth(cb) {
        return auth.onAuthStateChanged(async (fbUser) => {
          if (fbUser) {
            const email = norm(fbUser.email);
            const isLeader = await resolveIsLeader(email);
            current = { uid: fbUser.uid, email, isLeader };
          } else {
            current = null;
          }
          cb(current);
        });
      },

      async login(email, password) {
        await auth.signInWithEmailAndPassword(norm(email), password);
      },

      // Auto-cadastro: a pessoa cria a PRÓPRIA conta (permitido no cliente).
      // Papel inicial = colaborador (não grava em roles; ausência = colaborador).
      async signup(email, password) {
        await auth.createUserWithEmailAndPassword(norm(email), password);
        // onAuthStateChanged assume a partir daqui (já fica logada).
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
          // migração preguiçosa em cada doc lido (ver migrateOnRead)
          return snap.docs.map((d) => migrateOnRead({ id: d.id, ...d.data() }));
        }
        const doc = await col.doc(emailToId(current.email)).get();
        return doc.exists ? [migrateOnRead({ id: doc.id, ...doc.data() })] : [];
      },

      async save(member) {
        // grava o membro migrado e remove os campos legados de raiz do doc
        await col.doc(member.id).set(prepareForWrite(member, 'firebase'), { merge: true });
        return member;
      },

      async remove(id) {
        await col.doc(id).delete();
      },

      // ----- Gestão de papéis (apenas líder; imposto também nas regras) -----
      // Retorna todos os papéis gravados: [{ email, role }].
      async listRoles() {
        if (!current || !current.isLeader) return [];
        const snap = await rolesCol.get();
        return snap.docs.map((d) => ({ email: d.id, role: d.data().role }));
      },

      // Define o papel de um e-mail. 'leader' | 'collaborator'.
      async setRole(email, role) {
        const id = emailToId(email);
        await rolesCol.doc(id).set({ role, email: id, updatedAt: Date.now() }, { merge: true });
      },

      // Remove o papel de um e-mail (volta ao padrão Colaborador).
      // NÃO apaga o login (Authentication) nem a avaliação (members).
      async removeRole(email) {
        await rolesCol.doc(emailToId(email)).delete();
      },

      // ----- Cargos (coleção "cargos"; todos leem, só líder escreve) --------
      // Retorna os NOMES dos cargos adicionados (além dos fixos do model).
      async listCargos() {
        try {
          const snap = await cargosCol.get();
          return snap.docs.map((d) => (d.data() && d.data().name) || d.id);
        } catch (e) {
          return [];
        }
      },

      // Adiciona um cargo novo (id derivado do nome). Idempotente.
      async addCargo(name) {
        const nm = (name || '').trim();
        if (!nm) return;
        const id = nm.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
        await cargosCol.doc(id || Date.now().toString(36)).set(
          { name: nm, createdAt: Date.now() },
          { merge: true }
        );
      },
    };

    return store;
  }

  window.Store = useFirebase ? makeFirebaseStore() : LocalStore;

  // helpers expostos
  window.Store.isBootstrapLeader = isBootstrapLeader;
  window.Store.emailToId = emailToId;
  window.Store.normEmail = norm;
  window.Store.currentPeriodKey = currentPeriodKey;
  window.Store.periodKeyFor = periodKeyFor;
  // exposto para os self-tests (?selftest) exercitarem a migração real.
  window.Store.migrateOnRead = migrateOnRead;
  // exposto para os self-tests exercitarem a limpeza do HardSkill
  // (idempotência e preservação de soft/discipline/plan).
  window.Store.clearHardSkill = clearHardSkill;
})();
