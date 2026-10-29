/* Tests de non-régression des règles Firestore (firestore.rules) — à lancer
 * sur l'émulateur, JAMAIS sur la production.
 *
 *   1. npx firebase-tools emulators:start --only auth,firestore --project demo-fiftin
 *   2. npm install --no-save firebase@10
 *   3. node tests/firestore-rules.test.mjs
 *
 * Couvre : brouillons d'annonces (création, lecture privée, envoi à la
 * vérification à sens unique), statuts publiés/en attente, compteurs
 * protégés, et règles de l'outil Planning (accounts/{uid}).
 * Code de sortie 1 si un cas échoue. */
import {initializeApp} from 'firebase/app';
import {getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword} from 'firebase/auth';
import {getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, updateDoc, addDoc, collection} from 'firebase/firestore';
const mk=async(name,email)=>{ const app=initializeApp({apiKey:'k',projectId:'demo-fiftin'},name); const a=getAuth(app); connectAuthEmulator(a,'http://127.0.0.1:9099',{disableWarnings:true}); const db=getFirestore(app); connectFirestoreEmulator(db,'127.0.0.1',8085);
  if(email){ try{ await createUserWithEmailAndPassword(a,email,'secret123'); }catch(e){ await signInWithEmailAndPassword(a,email,'secret123'); } }
  return {db, uid: a.currentUser && a.currentUser.uid}; };
const H=await mk('h','regles-hote@test.fr'), O=await mk('o','regles-autre@test.fr'), V=await mk('v',null);
let ok=0, ko=0;
const R=Date.now().toString(36); // identifiants propres à ce passage : le test se relance sans nettoyer l'émulateur
const t=async(name, expect, fn)=>{ let got; try{ await fn(); got='autorisé'; }catch(e){ got='refusé'; } const pass=(got===expect); pass?ok++:ko++; console.log((pass?'OK  ':'ÉCHEC')+' '+name+' → '+got); };
const base=(st)=>({ownerUid:H.uid, status:st, name:'Test'});
const d1=doc(H.db,'listings','r-draft-'+R);
await t('hôte crée un brouillon','autorisé',()=>setDoc(d1, base('draft')));
await t('hôte crée une annonce "pending"','autorisé',()=>setDoc(doc(H.db,'listings','r-pend-'+R), base('pending')));
await t('hôte crée directement "published"','refusé',()=>setDoc(doc(H.db,'listings','r-pub-'+R), base('published')));
await t('hôte crée un brouillon au nom d\'un autre','refusé',()=>setDoc(doc(H.db,'listings','r-x-'+R), Object.assign(base('draft'),{ownerUid:O.uid})));
await t('hôte relit son brouillon','autorisé',()=>getDoc(d1));
await t('autre compte lit le brouillon','refusé',()=>getDoc(doc(O.db,'listings','r-draft-'+R)));
await t('visiteur non connecté lit le brouillon','refusé',()=>getDoc(doc(V.db,'listings','r-draft-'+R)));
await t('hôte modifie son brouillon (texte)','autorisé',()=>updateDoc(d1,{name:'Test 2'}));
await t('autre compte modifie le brouillon','refusé',()=>updateDoc(doc(O.db,'listings','r-draft-'+R),{name:'pirate'}));
await t('brouillon → published','refusé',()=>updateDoc(d1,{status:'published'}));
await t('brouillon → paused','refusé',()=>updateDoc(d1,{status:'paused'}));
await t('brouillon → pending (envoi)','autorisé',()=>updateDoc(d1,{status:'pending'}));
await t('pending → draft','refusé',()=>updateDoc(d1,{status:'draft'}));
await t('pending → published par l\'hôte','refusé',()=>updateDoc(d1,{status:'published'}));
await t('hôte gonfle ses stats','refusé',()=>updateDoc(d1,{stats:{confirmedCount:99}}));
// Régressions : annonces en attente et comptes de l'outil Planning
await setDoc(doc(H.db,'listings','r-pub2-'+R), base('pending')).catch(()=>{});
await t('hôte lit le compte Planning d\'un autre','refusé',()=>getDoc(doc(H.db,'accounts',O.uid)));
await t('hôte écrit son propre compte Planning','autorisé',()=>setDoc(doc(H.db,'accounts',H.uid),{settings:{name:'x'}}));
await t('autre compte écrit le compte Planning de l\'hôte','refusé',()=>setDoc(doc(O.db,'accounts',H.uid),{settings:{name:'pirate'}}));
await t('visiteur écrit publicAvail','refusé',()=>setDoc(doc(V.db,'listings','r-pend-'+R,'publicAvail','u1'),{ranges:[]}));
await t('visiteur lit une annonce en attente','refusé',()=>getDoc(doc(V.db,'listings','r-pend-'+R)));
console.log(ok+' OK, '+ko+' échec(s)'); process.exit(ko?1:0);
