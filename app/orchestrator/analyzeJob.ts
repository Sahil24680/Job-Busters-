// Main orchestrator that coordinates scraper, NLP, scoring, and DB

import { scrapeJobFromUrl } from "@/app/other/scraper";
import { getJobByCompositeKey, insertIntoJobTable, InsertStructuredJobFeatures, InsertToJobUpdatesTable, getJobUpdateTimestamps, createJobSnapshot, getLatestSnapshotForJob, getAllSnapshotsForJob } from "@/utils/supabase/action";
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeAdapterJob, Combined } from "@/app/api/data-ingestion/nlp/client";
import { analysisWithLLM } from "@/app/api/data-ingestion/nlp/index";
import { scoreJob, type AtsJobInput, type AtsJobFeatures } from "@/app/scoring/score";
import type { analysis } from "@/app/api/data-ingestion/nlp/index";
import { parseGreenhouseTenantAndJob } from "@/app/api/data-ingestion/adapters/util";
import type { AdapterJob } from "@/app/api/data-ingestion/adapters/types";
import { createSnapshotData, hasContentChanged, hasAtsUpdatedAtChanged } from "@/app/db/jobSnapshots";

export type Tier = "Low" | "Medium" | "High";

export interface RiskResult {
  score: number;
  tier: Tier;
  redFlags: string[];
  recommendations: string[];
}

/**
 * Validate that an AdapterJob actually contains job posting data
 * Returns validation result with error message if invalid
 */
function validateJobPosting(adapterJob: AdapterJob): { isValid: boolean; error?: string } {
  // Check critical fields
  const hasTitle = adapterJob.title && adapterJob.title.trim().length > 0;
  const hasLocation = adapterJob.location && adapterJob.location.trim().length > 0;
  
  // Check if company_name is just the hostname (indicates no extraction)
  let companyIsJustHostname = false;
  try {
    const url = new URL(adapterJob.absolute_url);
    companyIsJustHostname = adapterJob.company_name === url.hostname || 
                           adapterJob.company_name === url.hostname.replace('www.', '');
  } catch {
    // If URL parsing fails, assume company is not just hostname (safer to allow)
    companyIsJustHostname = false;
  }
  
  // Check extracted features
  const features = adapterJob.features || {};
  const hasSalary = !!(features.salary_min || features.salary_max);
  const hasTimeType = !!features.time_type;
  const hasCurrency = !!features.currency;
  const hasDepartment = !!features.department;
  
  // Calculate completeness score (0-100%)
  let completenessScore = 0;
  if (hasTitle) completenessScore += 25;
  if (hasLocation) completenessScore += 20;
  if (hasSalary) completenessScore += 20;
  if (hasTimeType) completenessScore += 10;
  if (hasCurrency) completenessScore += 10;
  if (hasDepartment) completenessScore += 5;
  if (!companyIsJustHostname) completenessScore += 10;
  
  // Validation rules:
  // 1. Must have title (critical)
  if (!hasTitle) {
    return { 
      isValid: false, 
      error: "No job title found. This doesn't appear to be a job posting page." 
    };
  }
  
  // 2. Must have at least location OR salary (indicates job content)
  if (!hasLocation && !hasSalary) {
    return { 
      isValid: false, 
      error: "No job location or salary information found. This doesn't appear to be a job posting page." 
    };
  }
  
  // 3. Completeness threshold: if < 30%, likely not a job posting
  if (completenessScore < 30) {
    return { 
      isValid: false, 
      error: "Insufficient job information found. This doesn't appear to be a job posting page. Please provide a direct link to a job posting." 
    };
  }
  
  // 4. If company is just hostname and no other features, likely not extracted
  if (companyIsJustHostname && completenessScore < 40) {
    return { 
      isValid: false, 
      error: "Unable to extract job information from this page. Please provide a direct link to a job posting." 
    };
  }
  
  return { isValid: true };
}

/**
 * Generate user-friendly recommendations based on red flags detected
 */
function generateRecommendations(breakdown: Record<string, number>): string[] {
  const recommendations: string[] = [];

  // Check if there are any red flags (scores < 0.5)
  const hasRedFlags = Object.values(breakdown).some(score => score < 0.5);
  
  if (!hasRedFlags) {
    recommendations.push("No ghosts detected! This looks like a legitimate opportunity.");
    return recommendations;
  }
  
  // Salary-related recommendations
  const salaryFlags = ['salary_disclosure', 'salary_min_present'];
  const hasMultipleSalaryFlags = salaryFlags.filter(flag => breakdown[flag] < 0.5).length >= 2;
  
  if (hasMultipleSalaryFlags) {
    recommendations.push("This posting has unclear compensation details. Ask about salary ranges during the interview.");
  } else {
    if (breakdown.salary_disclosure < 0.5) {
      recommendations.push("Ask about the salary range during the interview.");
    }
    if (breakdown.salary_min_present < 0.5) {
      recommendations.push("No stated minimum salary may be intentionally vague, depending on the nature of the job.");
    }
  }
  
  // NLP-related recommendations
  const nlpFlags = ['skills_present', 'buzzword_penalty'];
  const hasMultipleNlpFlags = nlpFlags.filter(flag => breakdown[flag] < 0.5).length >= 2;
  
  if (hasMultipleNlpFlags) {
    recommendations.push("Consider asking clarifying questions about the role and requirements - the description may be vague.");
  } else {
    if (breakdown.skills_present < 0.5) {
      recommendations.push("Ask for a detailed job description with specific technical requirements.");
    }
    if (breakdown.buzzword_penalty < 0.5) {
      recommendations.push("Seek concrete expectations and responsibilities beyond generic phrases.");
    }
  }
  
  // Update cadence, content change quality, and freshness recommendations
  const hasPredictableCadence = breakdown.update_cadence !== undefined && breakdown.update_cadence < 0.5;
  const hasStaleRefreshPattern = breakdown.content_change_quality !== undefined && breakdown.content_change_quality < 0.5;
  const hasStalePosting = breakdown.freshness < 0.5;
  
  // Triple combination: cadence + stale refresh + stale posting
  if (hasPredictableCadence && hasStaleRefreshPattern && hasStalePosting) {
    recommendations.push("This job refreshes in a predictable pattern with no significant content changes, and it is a stale posting. These three signals combined strongly indicate automated efforts to make a ghost job appear active.");
  }
  // Double combination: cadence + stale refresh (amplified signal)
  else if (hasPredictableCadence && hasStaleRefreshPattern) {
    recommendations.push("This job refreshes in a predictable pattern with no significant content changes. These two signals combined indicate automated efforts to make a ghost job appear active.");
  }
  // Double combination: cadence + stale posting
  else if (hasPredictableCadence && hasStalePosting) {
    recommendations.push("This job is both stale and refreshes in a predictable pattern. These two signals combined is a stronger signal of automated efforts to make a ghost job appear active.");
  }
  // Double combination: stale refresh + stale posting
  else if (hasStaleRefreshPattern && hasStalePosting) {
    recommendations.push("This job refreshes without significant content changes and is a stale posting. This pattern suggests the job may be reposted to appear active without real updates.");
  }
  // Individual messages
  else {
    if (hasStalePosting) {
      recommendations.push("This posting may be stale. Verify the position is still actively hiring (posted >30 days ago).");
    }
    if (hasPredictableCadence) {
      recommendations.push("This job refreshes in a predictable pattern, which could indicate automated efforts to make a ghost job appear active.");
    }
    if (hasStaleRefreshPattern) {
      recommendations.push("This job refreshes without significant content changes, which could indicate automated reposting to make a ghost job appear active.");
    }
  }
  
  return recommendations;
}

/**
 * Analyze a job URL and return scoring results
 * This is the main orchestrator that coordinates all components
 */
export async function analyzeJob(
  jobUrl: string,
  userId: string,
  supabase: SupabaseClient
): Promise<{
  success: boolean;
  jobId?: string;
  score?: RiskResult;
  features?: Combined;
  nlpAnalysis?: analysis;
  error?: string;
}> {
  try {
    // 1. Scrape the job to get composite key components
    const adapterJob = await scrapeJobFromUrl(jobUrl);
    
    if (!adapterJob) {
      // Check if scraping failed and whether there is an existing job - mark it as inactive
      try {
        const url = new URL(jobUrl);
        const parsed = parseGreenhouseTenantAndJob(url);
        if (parsed && (url.hostname.includes('greenhouse.io') || url.hostname.includes('job-boards.greenhouse.io'))) {
          const { tenant, jobId } = parsed;
          const existingJob = await getJobByCompositeKey(
            supabase,
            "greenhouse",
            tenant,
            jobId
          );
          
          if (existingJob) {
            // Job exists but can't be scraped - mark as inactive
            await supabase
              .from('jobs')
              .update({ 
                is_active: false,
                last_seen: new Date().toISOString()
              })
              .eq('id', existingJob.id);
          }
        }
      } catch (urlError) {
        // URL parsing failed, continue with error return
      }
      
      return { success: false, error: "Unable to access this job posting. The website may be blocking automated access, or the URL may be invalid. Please try using the 'Apply Now' link from the company's careers page instead." };
    }

    const { ats_provider, tenant_slug, external_job_id } = adapterJob;

    // 2. Check if job exists in DB by composite key
    const existingJob = await getJobByCompositeKey(
      supabase,
      ats_provider,
      tenant_slug,
      external_job_id
    );

    let jobId: string;
    let features: Combined;

    // Type for job returned from database
    type JobWithFeatures = {
      id: string;
      last_seen: string | null;
      updated_at: string | null;
      job_features?: Array<Combined>;
    };

    // Helper function to check if job data is fresh (< 24 hours)
    const isJobFresh = (job: JobWithFeatures): boolean => {
      const lastSeen = job.last_seen;
      if (!lastSeen) return false; // Null means not fresh
      
      const hoursSinceSeen = 
        (Date.now() - new Date(lastSeen).getTime()) / (1000 * 60 * 60);
      return hoursSinceSeen < 24;
    };

    // For ATS jobs: check cache and persist to DB
    // For web jobs: ephemeral only, don't persist to DB
    if (ats_provider === "greenhouse") {
      if (existingJob && isJobFresh(existingJob) && existingJob.job_features?.[0]) {
        // 3a. ATS job exists, is fresh, and has features - use cached data
        jobId = existingJob.id;
        
        // Extract features from DB
        const dbFeatures = existingJob.job_features[0] as Combined;
        features = dbFeatures;
        
        console.log(`[analyzeJob] Using cached ATS job: ${jobId}`);
      } else {
        // 3b. New ATS job OR stale ATS job - scrape and save/update
        
        // For existing jobs: Record update BEFORE updating the jobs table
        // This ensures we compare the incoming updated_at with the OLD value in the database
        if (existingJob) {
          await InsertToJobUpdatesTable(supabase, existingJob.id, adapterJob);
        }
        
        // Upsert will create new row or update existing, returns ID
        jobId = await insertIntoJobTable(supabase, adapterJob);
        
        if (!jobId) {
          return { success: false, error: "Failed to save job to database" };
        }

        // For new jobs: Always record the first update (insert directly since comparison would fail)
        if (!existingJob && adapterJob.updated_at) {
          const { error } = await supabase
            .from("job_updates")
            .insert({
              job_id: jobId,
              ats_updated_at: adapterJob.updated_at
            });
          
          if (error) {
            console.error("[analyzeJob] Failed to insert first job update:", error);
          }
        }

        // Run NLP analysis to get features
        const nlpFeatures = await analyzeAdapterJob(adapterJob);
        features = nlpFeatures;
        
        // Save features to DB
        await InsertStructuredJobFeatures(supabase, jobId, adapterJob);
        
        //SNAPSHOT LOGIC: Track job changes over time
        //Create snapshot data from the current job data
        const newSnapshotData = createSnapshotData(jobId, adapterJob);
        
        if (!existingJob) {
          //New job: Always create first snapshot
          await createJobSnapshot(supabase, newSnapshotData);
          console.log(`[analyzeJob] Created first snapshot for new ATS job: ${jobId}`);
        } else {
          //Existing job: Check if ats_updated_at changed
          const latestSnapshot = await getLatestSnapshotForJob(supabase, jobId);
          
          if (!latestSnapshot) {
            //Job exists but no snapshot yet - create one
            await createJobSnapshot(supabase, newSnapshotData);
            console.log(`[analyzeJob] Created first snapshot for existing ATS job: ${jobId}`);
          } else if (hasAtsUpdatedAtChanged(latestSnapshot, adapterJob.updated_at)) {
            //ats_updated_at changed - create new snapshot
            await createJobSnapshot(supabase, newSnapshotData);
            const contentChanged = hasContentChanged(latestSnapshot, newSnapshotData);
            console.log(`[analyzeJob] ATS updated_at changed - created snapshot for: ${jobId}${contentChanged ? ' (content also changed)' : ' (no content change)'}`);
          } else {
            console.log(`[analyzeJob] ATS updated_at unchanged, skipping snapshot for: ${jobId}`);
          }
        }
        
        if (existingJob) {
          console.log(`[analyzeJob] Updated stale ATS job: ${jobId}`);
        } else {
          console.log(`[analyzeJob] Scraped and saved new ATS job: ${jobId}`);
        }
      }
    } else {
      // Web jobs: ephemeral only, don't persist to DB
      
      // Validate that this is actually a job posting before running expensive NLP
      const validationResult = validateJobPosting(adapterJob);
      if (!validationResult.isValid) {
        return { 
          success: false, 
          error: validationResult.error || "This doesn't appear to be a job posting. Please provide a direct link to a job posting page." 
        };
      }
      
      // Generate a temporary ID for the response (won't be saved)
      jobId = `web-${Date.now()}`;
      
      // Run NLP analysis to get features
      const nlpFeatures = await analyzeAdapterJob(adapterJob);
      features = nlpFeatures;
      
      console.log(`[analyzeJob] Processed ephemeral web job: ${jobId}`);
    }

    // 4. Run ephemeral NLP analysis (skills, buzzwords, etc.)
    // Convert HTML to plain text and truncate to 20K chars
    const { htmlToPlainText } = await import("@/app/api/data-ingestion/adapters/util");
    const rawText = adapterJob.content || "";
    const plainText = htmlToPlainText(rawText).slice(0, 20_000);
    console.log(`[analyzeJob] Content length for NLP: ${rawText.length} chars raw -> ${plainText.length} chars plain`);
    
    const nlpAnalysis = await analysisWithLLM({
      text: plainText,
      metadata: {
        time_type: features?.time_type as string | null,
        currency: features?.currency as string | null
      }
    });
    
    console.log(`[analyzeJob] NLP extracted ${nlpAnalysis.skills.length} skills:`, nlpAnalysis.skills.map(s => s.name).slice(0, 5));

    // 5. Fetch update cadence data for ATS jobs (only if job exists in DB)
    let updateCadenceData: string[] | undefined = undefined;
    let snapshotData: Array<{ content_simhash: string; metadata_simhash: string }> | undefined = undefined;
    
    if (ats_provider !== "web" && jobId) {
      updateCadenceData = await getJobUpdateTimestamps(supabase, jobId);
      // Only include if we have at least 4 updates (baseline for pattern detection)
      if (updateCadenceData.length < 4) {
        updateCadenceData = undefined; // Not enough data, don't include in scoring
      }
      
      // Fetch snapshot data (for content change quality analysis)
      const snapshots = await getAllSnapshotsForJob(supabase, jobId);
      // Only include if we have at least 2 snapshots (need at least 2 to compare)
      if (snapshots.length >= 2) {
        snapshotData = snapshots.map(s => ({
          content_simhash: s.content_simhash,
          metadata_simhash: s.metadata_simhash
        }));
      }
    }

    // 6. Combine features with NLP analysis for scoring
    const scoringInput: AtsJobInput = {
      source: (ats_provider === "web" ? "web" : "ats") as "ats" | "web",
      absolute_url: adapterJob.absolute_url,
      first_published: adapterJob.first_published,
      updated_at: adapterJob.updated_at,
      features: features as AtsJobFeatures,
      // For web jobs, if successfully scraped, the link is valid
      // For ATS jobs, if successfully got the job, the link is valid
      link_ok: true, // Both web and ATS jobs passed
      link_loop: false,
      nlp_analysis: {
        skills: nlpAnalysis.skills,
        buzzwords: nlpAnalysis.buzzwords,
        comp_period_detected: nlpAnalysis.comp_period_detected
      },
      update_cadence_data: updateCadenceData,
      snapshot_data: snapshotData
    };

    // 7. Score the job
    const scoreResult = await scoreJob(scoringInput);
    console.log(`[analyzeJob] Score breakdown:`, scoreResult.breakdown);
    const tier: Tier = scoreResult.score < 0.4 ? "High" : scoreResult.score < 0.7 ? "Medium" : "Low";

    // Generate recommendations based on red flags
    const recommendations = generateRecommendations(scoreResult.breakdown);

    return {
      success: true,
      jobId,
      score: {
        score: scoreResult.score,
        tier,
        redFlags: Object.keys(scoreResult.breakdown).filter(k => scoreResult.breakdown[k] < 0.5),
        recommendations
      },
      features,
      nlpAnalysis
    };

  } catch (error: any) {
    console.error("[analyzeJob] Error:", error);
    return { success: false, error: error.message || "Unknown error" };
  }
}