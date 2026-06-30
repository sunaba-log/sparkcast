import "server-only";

import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  getFirebaseServiceAccountJson,
  getGoogleCloudProject,
  parseServiceAccountJson,
} from "@/server/env";

function getAdminApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const serviceAccountJson = getFirebaseServiceAccountJson();
  return initializeApp({
    projectId: getGoogleCloudProject(),
    credential: serviceAccountJson
      ? cert(parseServiceAccountJson(serviceAccountJson))
      : applicationDefault(),
  });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp());
}
