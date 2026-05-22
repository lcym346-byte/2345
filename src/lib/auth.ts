import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserRole } from '@/types';

export async function signIn(email: string, password: string) {
  return await signInWithEmailAndPassword(auth, email, password);
}

export async function signOut() {
  return await fbSignOut(auth);
}

export async function createUser(params: {
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
  storeId: string | null;
}) {
  const cred = await createUserWithEmailAndPassword(
    auth,
    params.email,
    params.password
  );
  await setDoc(doc(db, 'users', cred.user.uid), {
    email: params.email,
    displayName: params.displayName,
    role: params.role,
    storeId: params.storeId,
    active: true,
    createdAt: serverTimestamp()
  });
  return cred.user;
}
