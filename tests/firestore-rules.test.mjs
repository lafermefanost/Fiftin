/* Tests de non-régression des règles Firestore (firestore.rules) — à lancer
 * sur l'émulateur, JAMAIS sur la production.
 *
 *   1. npx firebase-tools emulators:start --only auth,firestore --project demo-fiftin
 *   2. npm install --no-save firebase@10
 *   3. node tests/firestore-rules.test.mjs
 *
 * Couvre : mise en ligne directe à vérifier (reviewed jamais écrit par
 * l'hôte), annonces retirées, brouillons (lecture privée, mise en ligne à
 * sens unique), compteurs protégés, et règles de l'outil Planning
 * (accounts/{uid}).
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
const base=(st)=>({ownerUid:H.uid, status:st, name:'Test', reviewed:false});
const d1=doc(H.db,'listings','r-draft-'+R), dp=doc(H.db,'listings','r-pub-'+R);
// Mise en ligne directe, vérifiée ensuite par un admin (reviewed)
await t('hôte met une annonce en ligne (à vérifier)','autorisé',()=>setDoc(dp, base('published')));
await t('visiteur lit cette annonce en ligne','autorisé',()=>getDoc(doc(V.db,'listings','r-pub-'+R)));
await t('hôte crée une annonce déjà « vérifiée »','refusé',()=>setDoc(doc(H.db,'listings','r-v-'+R), Object.assign(base('published'),{reviewed:true})));
await t('hôte crée une annonce sans marque « à vérifier »','refusé',()=>setDoc(doc(H.db,'listings','r-nv-'+R), {ownerUid:H.uid, status:'published', name:'x'}));
await t('hôte se marque lui-même « vérifié »','refusé',()=>updateDoc(dp,{reviewed:true}));
await t('hôte crée une annonce « retirée »','refusé',()=>setDoc(doc(H.db,'listings','r-rm-'+R), base('removed')));
await t('hôte met en pause son annonce','autorisé',()=>updateDoc(dp,{status:'paused'}));
await t('hôte la remet en ligne','autorisé',()=>updateDoc(dp,{status:'published'}));
await t('hôte crée une annonce au nom d\'un autre','refusé',()=>setDoc(doc(H.db,'listings','r-x-'+R), Object.assign(base('published'),{ownerUid:O.uid})));
// Brouillons
await t('hôte crée un brouillon','autorisé',()=>setDoc(d1, base('draft')));
await t('hôte relit son brouillon','autorisé',()=>getDoc(d1));
await t('autre compte lit le brouillon','refusé',()=>getDoc(doc(O.db,'listings','r-draft-'+R)));
await t('visiteur non connecté lit le brouillon','refusé',()=>getDoc(doc(V.db,'listings','r-draft-'+R)));
await t('hôte modifie son brouillon (texte)','autorisé',()=>updateDoc(d1,{name:'Test 2'}));
await t('autre compte modifie le brouillon','refusé',()=>updateDoc(doc(O.db,'listings','r-draft-'+R),{name:'pirate'}));
await t('brouillon → paused','refusé',()=>updateDoc(d1,{status:'paused'}));
await t('brouillon → removed','refusé',()=>updateDoc(d1,{status:'removed'}));
await t('brouillon → en ligne','autorisé',()=>updateDoc(d1,{status:'published'}));
await t('en ligne → brouillon','refusé',()=>updateDoc(d1,{status:'draft'}));
await t('hôte gonfle ses stats','refusé',()=>updateDoc(d1,{stats:{confirmedCount:99}}));
// Régressions : annonces en attente et comptes de l'outil Planning
await t('hôte lit le compte Planning d\'un autre','refusé',()=>getDoc(doc(H.db,'accounts',O.uid)));
await t('hôte écrit son propre compte Planning','autorisé',()=>setDoc(doc(H.db,'accounts',H.uid),{settings:{name:'x'}}));
await t('autre compte écrit le compte Planning de l\'hôte','refusé',()=>setDoc(doc(O.db,'accounts',H.uid),{settings:{name:'pirate'}}));
await setDoc(doc(H.db,'listings','r-pend-'+R), base('pending'));
await t('visiteur lit une annonce en attente (ancien dépôt)','refusé',()=>getDoc(doc(V.db,'listings','r-pend-'+R)));
await t('hôte publie lui-même un ancien dépôt en attente','refusé',()=>updateDoc(doc(H.db,'listings','r-pend-'+R),{status:'published'}));
await t('visiteur écrit publicAvail','refusé',()=>setDoc(doc(V.db,'listings','r-pend-'+R,'publicAvail','u1'),{ranges:[]}));
console.log(ok+' OK, '+ko+' échec(s)'); process.exit(ko?1:0);
