import {
  getAdvertiser360,
  getCommercialCommandCentre,
  listCatalogue,
  listAdvertisers,
  listPipeline,
  loadAdvertisingData
} from "@raring2go/advertising";
import { createDb } from "@raring2go/db";
import type { AdvertisingActorContext } from "@raring2go/advertising";
import { getPermissionData } from "./permission-source";

export async function listAdvertiser360Rows(context: AdvertisingActorContext) {
  const advertisingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return listAdvertisers(context, advertisingPermissionData, await loadAdvertisingData(db));
  } finally {
    await sql.end();
  }
}

export async function readPipeline(context: AdvertisingActorContext) {
  const advertisingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return listPipeline(context, advertisingPermissionData, await loadAdvertisingData(db));
  } finally {
    await sql.end();
  }
}

export async function readCatalogue(context: AdvertisingActorContext) {
  const advertisingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return listCatalogue(context, advertisingPermissionData, await loadAdvertisingData(db));
  } finally {
    await sql.end();
  }
}

export async function readCommercialCommandCentre(context: AdvertisingActorContext) {
  const advertisingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return getCommercialCommandCentre(context, advertisingPermissionData, await loadAdvertisingData(db));
  } finally {
    await sql.end();
  }
}

export async function readAdvertiser360(context: AdvertisingActorContext, advertiserId: string) {
  const advertisingPermissionData = await getPermissionData();
  const { db, sql } = createDb();

  try {
    return getAdvertiser360(context, advertisingPermissionData, await loadAdvertisingData(db), advertiserId);
  } finally {
    await sql.end();
  }
}

