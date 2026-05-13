import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  orderBy, 
  limit,
  getDocs,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '@/src/lib/firebase';
import { PageContent } from './pdfService';
import { TTSOptions } from './ttsService';

export interface CustomVoice {
  id?: string;
  userId: string;
  name: string;
  sampleBase64: string;
  createdAt: any;
}

export interface ReadingSession {
  id?: string;
  userId: string;
  fileName: string;
  pages: PageContent[];
  createdAt: any;
  updatedAt?: any;
  settings: TTSOptions;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function createSession(fileName: string, pages: PageContent[]) {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error("User not authenticated");

  const path = 'sessions';
  try {
    const docRef = await addDoc(collection(db, path), {
      userId,
      fileName,
      pages,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      settings: {
        voice: 'Kore',
        speed: 1,
        pitch: 1
      }
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSession(sessionId: string, pages: PageContent[], settings: TTSOptions) {
  const docRef = doc(db, 'sessions', sessionId);
  try {
    await updateDoc(docRef, {
      pages,
      settings,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function getSessions() {
  const userId = auth.currentUser?.uid;
  if (!userId) return [];

  const path = 'sessions';
  try {
    const q = query(
      collection(db, path),
      where("userId", "==", userId),
      limit(50)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    })) as ReadingSession[];
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function deleteSession(sessionId: string) {
  try {
    await deleteDoc(doc(db, 'sessions', sessionId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `sessions/${sessionId}`);
  }
}

// Custom Voices
export async function createVoice(name: string, sampleBase64: string) {
  const userId = auth.currentUser?.uid;
  if (!userId) throw new Error("User not authenticated");

  const path = 'voices';
  try {
    const docRef = await addDoc(collection(db, path), {
      userId,
      name,
      sampleBase64,
      createdAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function getVoices() {
  const userId = auth.currentUser?.uid;
  if (!userId) return [];

  const path = 'voices';
  try {
    const q = query(
      collection(db, path),
      where("userId", "==", userId),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({
      id: d.id,
      ...d.data()
    })) as CustomVoice[];
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
    return [];
  }
}

export async function updateVoice(voiceId: string, name: string) {
  try {
    await updateDoc(doc(db, 'voices', voiceId), { name });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `voices/${voiceId}`);
  }
}

export async function deleteVoice(voiceId: string) {
  try {
    await deleteDoc(doc(db, 'voices', voiceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `voices/${voiceId}`);
  }
}
