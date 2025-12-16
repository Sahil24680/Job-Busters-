"use server";
import { createClient } from "./server";
import { redirect } from "next/navigation";
import type { AdapterJob } from "@/app/api/data-ingestion/adapters/types";   
import type { dbJobFeatures } from "@/app/db/jobFeatures";   
import type { dbJobSnapshot } from "@/app/db/jobSnapshots";
import {analyzeAdapterJob} from "@/app/api/data-ingestion/nlp/client";
import type { SupabaseClient } from '@supabase/supabase-js';

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { error } : { success: true };
}

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const { error } = await supabase.auth.signUp({ email, password });
  return error ? { error } : { success: true };
}

export async function logout() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  redirect("/auth/login");
}

export async function updatePassword(newPassword: string) {
  const supabase = await createClient();

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return error ? { error } : { success: true };
}

export async function updateName(firstName: string | null, lastName: string | null) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) return { success: false, error: "Not authenticated" };

  const { error } = await supabase
    .from("users")
    .update({
      first_name: firstName?.trim() || null,
      last_name: lastName?.trim() || null,
    })
    .eq("id", auth.user.id);

  return error ? { success: false, error: error.message } : { success: true };
}

export async function getUser() {
  const supabase = await createClient();
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      return { error: error.message };
    }
    if (!data.user) { 
        return { error: "No active session found" };
    }
    return data.user;
  } catch (error) {
    // @ts-ignore
    return { error: error.message };
  }
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ExtensionTypes: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

type UploadResult =
  | { success: true; path: string }
  | { success: false; error: string };

function getFileValidation(file: File): string | null {
  if (!(file instanceof File)) {
    return "No file provided";
  }

  const allowedExtensionTypes = Object.keys(ExtensionTypes);
  if (!allowedExtensionTypes.includes(file.type)) {
    return `Unsupported file type. Allowed: ${allowedExtensionTypes.map(t => t.split('/')[1]).join(', ')}`;
  }

  if (file.size > MAX_FILE_SIZE) {
    return `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`;
  }

  return null; // Validation passed
}

export async function uploadProfilePicture(formData: FormData): Promise<UploadResult> {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) {
    return { success: false as const, error: authErr?.message || "Not authenticated" };
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    // If 'file' is null or a string , it's not an instance of File.
    return { success: false as const, error: "No valid file provided" };
  }

  // File Validation
  const actualFile = file as File;
  const validationError = getFileValidation(actualFile);
  if (validationError) {
    return { success: false as const, error: validationError };
  }

  // Determine File Path
  const ext = ExtensionTypes[actualFile.type] || "jpg"; // Should not happen due to validation
  const filePath = `${auth.user.id}/avatar.${ext}`;
  const bucketName = "profile-pictures";

  // Upload to Storage
  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(filePath, actualFile, {
      upsert: true,
      contentType: actualFile.type,
      cacheControl: "3600",
    });

  if (uploadError) {
    return { success: false as const, error: `Upload failed: ${uploadError.message}` };
  }

  // Update Database Path
  const { error: dbError } = await supabase
    .from("users")
    .update({ profile_picture_path: filePath })
    .eq("id", auth.user.id);

  if (dbError) {
    // Attempt to delete the file uploaded to prevent storage inconsistency
    console.error(`DB Update failed for user ${auth.user.id}. Raw DB Error: ${dbError.message}. Attempting file cleanup.`);
    await supabase.storage
      .from(bucketName)
      .remove([filePath])
      .catch((e) => console.error("Cleanup failed:", e)); // Logging failure

    return { success: false as const, error: "Profile update failed due to a system error. Please try again." };
  }

  return { success: true as const, path: filePath };
}

export type Profile = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string | null; 
  profileUrl: string | null;  // link to image for browser 
  profile_picture_path: string | null; //unique key for storage in supabase 
};

export async function getMyProfileSettings(): Promise<
  | { success: true; profile: Profile }
  | { success: false; error: string }
> {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth.user) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: row, error } = await supabase
    .from("users")
    .select("created_at, email, first_name, last_name, profile_picture_path")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error) return { success: false, error: error.message };

  const profile_picture_path = row?.profile_picture_path ?? null;

  let signedProfileUrl: string | null = null;
  if (profile_picture_path) {
    const { data: signed, error: signErr } = await supabase.storage
      .from("profile-pictures")
      .createSignedUrl(profile_picture_path, 60 * 60);

    if (!signErr) signedProfileUrl = signed?.signedUrl ?? null;
  }
  const profile: Profile = {
    id: auth.user.id,
    email: auth.user.email ?? row?.email ?? null,
    first_name: row?.first_name ?? null,
    last_name: row?.last_name ?? null,
    created_at: (row?.created_at as string | null) ?? null,
    profile_picture_path,
    profileUrl : signedProfileUrl,
  };

  return { success: true, profile };
}


export async function request_lock_and_tokens(userId: string) {
  const supabase = await createClient();

  const { data: row, error } = await supabase
    .from("request_lock")
    .select("is_available, tokens_remaining")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[request_lock_and_tokens] select error:", error);
    throw error;
  }

  if (!row) {
    const { data: created, error: insertErr } = await supabase
      .from("request_lock")
      .insert({ user_id: userId, is_available: true, tokens_remaining: 3 })
      .select("is_available, tokens_remaining")
      .single();

    if (insertErr) throw insertErr;
    return {
      is_available: created!.is_available,
      tokens: created.tokens_remaining,
    };
  }

  return { is_available: row.is_available, tokens: row.tokens_remaining };
}

export async function set_request_lock(userId: string) {
  const supabase = await createClient();
  // set the lock
  const { data, error } = await supabase
    .from("request_lock")
    .update({ is_available: false })
    .eq("user_id", userId)
    .eq("is_available", true)
    .select("tokens_remaining")
    .maybeSingle();

  if (error) throw error;
  if (!data) return false;

  // decrement token
  const { error: decErr } = await supabase
    .from("request_lock")
    .update({ tokens_remaining: data.tokens_remaining - 1 })
    .eq("user_id", userId);

  if (decErr) {
    // prevent a stuck lock if decrement fails
    await supabase
      .from("request_lock")
      .update({ is_available: true })
      .eq("user_id", userId);
    throw decErr;
  }
  return true;
}

export async function release_request_lock(userId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("request_lock")
    .update({ is_available: true })
    .eq("user_id", userId);
  if (error) console.error("[release_request_lock] release error:", error);
}



export async function insertIntoJobTable(supabase: SupabaseClient, jobDetails: AdapterJob) {

  const {
  ats_provider,
  tenant_slug,
  external_job_id,
  title,
  company_name,
  location,
  absolute_url,
  first_published,
  updated_at,
  requisition_id,
  content,
  raw_json,
} = jobDetails

const jobInsert = {
  ats: ats_provider,
  tenant_slug,
  external_job_id,
  title,
  company_name,
  location,
  absolute_url,
  first_published,
  updated_at,
  requisition_id,
  content,
  raw_json,
  is_active: true,
}

  const { data: jobId, error } = await supabase
    .from('jobs')
    .upsert([jobInsert], { onConflict: 'ats,tenant_slug,external_job_id' }) // composite key either returns new key or reuse if duplicate
    .select('id'); 

  if (error) {
    console.error("Error during upsert:", error);
    return null; 
  }
  
  if (!jobId || jobId.length === 0) {
    console.error("Upsert succeeded but did not return an ID.");
    return null;
  }

  // jobId is an object array and will contain one object for id
  return jobId[0].id;
}


export async function InsertToJobUpdatesTable(supabase: SupabaseClient, job_Id: string, jobDetails: AdapterJob) {
    const { updated_at: incomingAtsUpdatedAt } = jobDetails;

    // 1. Fetch the job row (only need existing updated_at)
    const { data: jobRow, error: fetchError } = await supabase
        .from("jobs")
        .select("updated_at")
        .eq("id", job_Id)
        .single(); // Use single since we know the ID exists

    if (fetchError || !jobRow) {
        console.error("[updateJobTimeline] Failed to fetch job timeline data:", fetchError);
        return false;
    }

    const existingUpdatedAt = jobRow.updated_at;
    
    if (!incomingAtsUpdatedAt) {
      return false;
    }
    
    if (!existingUpdatedAt) {
      // If no existing updated_at, treat as new update
      const { error: updateError } = await supabase
        .from("job_updates")
        .insert({
          job_id: job_Id,
          ats_updated_at: incomingAtsUpdatedAt
        });

      if (updateError) {
        console.error("[InsertToJobUpdates] Failed to insert job_update:", updateError);
      }
      
      // Always update last_seen
      const { error: seenError } = await supabase
        .from("jobs")
        .update({ last_seen: new Date().toISOString() })
        .eq("id", job_Id);

      if (seenError) {
        console.error("[InsertToJobUpdates] Failed to update last_seen:", seenError);
      }
      
      return !updateError;
    }
    
    const incomingTime = new Date(incomingAtsUpdatedAt).getTime();
    const existingTime = new Date(existingUpdatedAt).getTime();

    // 2. Insert into job_updates ONLY if incoming is newer
    let inserted = false;
    if (incomingTime > existingTime) {
      const { error: updateError } = await supabase
        .from("job_updates")
        .insert({
          job_id: job_Id,
          ats_updated_at: incomingAtsUpdatedAt
        });

      if (updateError) {
        console.error("[InsertToJobUpdates] Failed to insert job_update:", updateError);
      } else {
        inserted = true;
      }
    }

    // Step 3: Always update last_seen
    const { error: seenError } = await supabase
      .from("jobs")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", job_Id);

    if (seenError) {
      console.error("[InsertToJobUpdates] Failed to update last_seen:", seenError);
    }
    
    return inserted;
}




export async function InsertIntoJobFeaturesTable(supabase: SupabaseClient, jobFeatures:dbJobFeatures) {
  const { job_id, ...featureFields } = jobFeatures;

  const { error } = await supabase.from('job_features').upsert(
    [
       {
        job_id,
        ...featureFields,
       },
    ],
    { onConflict: 'job_id' }
  );
  
  if (error) {
    console.error("Error upserting job_features:", error);
  }
}

/**
 * Fetch update timestamps from job_updates table for cadence analysis.
 * Returns array of ats_updated_at timestamps, sorted chronologically.
 * Only fetches the latest 50 entries to avoid expensive operations on large datasets.
 */
export async function getJobUpdateTimestamps(
  supabase: SupabaseClient,
  jobId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("job_updates")
    .select("ats_updated_at")
    .eq("job_id", jobId)
    .order("ats_updated_at", { ascending: false })
    .limit(50); // Limit to latest 50 entries (enough to detect patterns)

  if (error) {
    console.error("[getJobUpdateTimestamps] Failed to fetch job updates:", error);
    return [];
  }

  if (!data || data.length === 0) {
    return [];
  }

  // Extract and filter valid timestamps, then reverse to chronological order
  // (oldest first) for cadence analysis
  return data
    .map(row => row.ats_updated_at)
    .filter((ts): ts is string => ts !== null && ts !== undefined)
    .reverse(); // Reverse to get chronological order (oldest to newest)
}

export async function InsertStructuredJobFeatures(supabase: SupabaseClient, job_Id: string, jobDetails: AdapterJob) {

  const featuresNormalized = await analyzeAdapterJob(jobDetails);

  const sanitized: dbJobFeatures = {
    job_id: job_Id,
    time_type: featuresNormalized.time_type ?? null,
    salary_min: featuresNormalized.salary_min ?? null,
    salary_mid: featuresNormalized.salary_mid ?? null,
    salary_max: featuresNormalized.salary_max ?? null,
    currency: featuresNormalized.currency ?? null,
    department: featuresNormalized.department ?? null,
    salary_source: featuresNormalized.salary_source ?? null,
  };

  await InsertIntoJobFeaturesTable(supabase, sanitized);
}

//This function is primarily for the job ingestion workflow
//Accepts jobDetails as input
//Gets the current user and job ID and Links them in user_job_check
//Returns a success flag
export async function InsertIntoUserJobCheckTable(supabase: SupabaseClient, user_Id: string, job_Id: string, job_ats_updated_at: string | null) {
  const { error } = await supabase.from('user_job_checks').upsert([
    {
      user_id: user_Id,
      job_id: job_Id,
      ats_updated_at: job_ats_updated_at,
    },
  ], { onConflict: 'user_id,job_id' });
  
  if (error) {
    console.error('Failed to link user to job:', error);
    return false;
  }
  
  return true;
}

/**
 * Get job from database by composite key
 * Returns job with features and updates table info
 */
export async function getJobByCompositeKey(
  supabase: SupabaseClient,
  ats: string,
  tenant_slug: string,
  external_job_id: string
) {
  const { data, error } = await supabase
    .from('jobs')
    .select(`
      *,
      job_features(*),
      job_updates(*)
    `)
    .eq('ats', ats)
    .eq('tenant_slug', tenant_slug)
    .eq('external_job_id', external_job_id)
    .maybeSingle();
    
  if (error) {
    console.error("Error getting job by composite key:", error);
    return null;
  }
  
  return data;
}


// Link the current user to a job (save job)
export async function saveJobForCurrentUser(jobId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("user_job_checks")
    .upsert(
      [
        {
          user_id: user.id,
          job_id: jobId,
        },
      ],
      { onConflict: "user_id,job_id" }
    );

  if (error) {
    console.error("[saveJobForCurrentUser] error:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function unsaveJobForCurrentUser(jobId: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("user_job_checks") 
    .delete()
    .eq("user_id", user.id)
    .eq("job_id", jobId);

  if (error) {
    console.error("[unsaveJobForCurrentUser] error:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}


export async function getSavedJobsForCurrentUser() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const { data, error } = await supabase
    .from("user_job_checks")
    .select(
      `
      job_id,
      checked_at,
      jobs (
        id,
        title,
        company_name,
        location,
        absolute_url,
        updated_at,
        ats,
        job_features (
          salary_min,
          salary_max,
          currency,
          time_type,
          department
        )
      )
    `
    )
    .eq("user_id", user.id)
    .order("checked_at", { ascending: false });

  if (error) {
    console.error("[getSavedJobsForCurrentUser] error:", error);
    return { success: false, error: error.message };
  }

  return { success: true, jobs: data ?? [] };
}

/**
 * Create a new job snapshot in the database
 * 
 * param: snapshot - Complete snapshot data with all hashes computed
 * returns: true if successful, false if error
 */
export async function createJobSnapshot(
  supabase: SupabaseClient,
  snapshot: dbJobSnapshot
): Promise<boolean> {
  const {
    job_id,
    ats_updated_at,
    raw_json,
    content_hash,
    metadata_hash,
    content_simhash,
    metadata_simhash,
  } = snapshot;

  const snapshotInsert = {
    job_id,
    snapshot_at: new Date().toISOString(),
    ats_updated_at,
    raw_json,
    content_hash,
    metadata_hash,
    content_simhash,
    metadata_simhash,
  };

  const { error } = await supabase
    .from('job_snapshots')
    .insert(snapshotInsert);

  if (error) {
    console.error('[createJobSnapshot] Failed to create snapshot:', error);
    return false;
  }

  return true;
}


/**
 * Get the most recent snapshot for a specific job
 * Used to compare against new data to detect changes
 * 
 * returns: Latest snapshot or null if none exists
 */
export async function getLatestSnapshotForJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<dbJobSnapshot | null> {
  const { data, error } = await supabase
    .from('job_snapshots')
    .select('*')
    .eq('job_id', jobId)
    .order('snapshot_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[getLatestSnapshotForJob] Error fetching snapshot:', error);
    return null;
  }

  return data;
}

/**
 * Get all snapshots for a specific job, ordered chronologically
 * 
 * @param supabase - Supabase client
 * @param jobId - Job ID to fetch snapshots for
 * @returns Array of snapshots ordered by snapshot_at (oldest first)
 */
export async function getAllSnapshotsForJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<dbJobSnapshot[]> {
  const { data, error } = await supabase
    .from('job_snapshots')
    .select('*')
    .eq('job_id', jobId)
    .order('snapshot_at', { ascending: true }); // Oldest first for chronological analysis

  if (error) {
    console.error('[getAllSnapshotsForJob] Error fetching snapshots:', error);
    return [];
  }

  return data || [];
}

