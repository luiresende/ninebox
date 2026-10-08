// ============================================================================
// CONFIGURAÇÃO DO FIREBASE
// ============================================================================
// 1. Acesse https://console.firebase.google.com e crie um projeto.
// 2. Em "Configurações do projeto" > "Seus apps", crie um app Web (ícone </>).
// 3. Copie o objeto de configuração e cole substituindo os valores abaixo.
// 4. No menu "Firestore Database", crie o banco (pode iniciar em modo de teste).
//
// Enquanto os valores estiverem como "COLE_AQUI_...", o app roda em MODO LOCAL
// (salva os dados apenas no navegador via localStorage). Assim você consegue
// testar tudo antes de plugar o Firebase.
// ============================================================================

window.FIREBASE_CONFIG = {
  apiKey: "COLE_AQUI_SUA_API_KEY",
  authDomain: "COLE_AQUI_SEU_PROJETO.firebaseapp.com",
  projectId: "COLE_AQUI_SEU_PROJECT_ID",
  storageBucket: "COLE_AQUI_SEU_PROJETO.appspot.com",
  messagingSenderId: "COLE_AQUI_SEU_SENDER_ID",
  appId: "COLE_AQUI_SEU_APP_ID"
};
