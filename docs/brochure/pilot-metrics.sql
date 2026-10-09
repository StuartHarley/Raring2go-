-- Advantage MIS pilot proof points — READ-ONLY aggregate queries
-- Target: Neon project "KK MIS" (aged-darkness-91795816), default branch.
-- Excludes test centres. Returns counts and averages only, except query 3,
-- which returns testimonials where the customer ticked testimonialConsent.
-- Run each statement separately in the Neon SQL editor and send me the output.

-- 1. Headline counts
with c as (select id from "Centre" where coalesce("isTest", false) = false)
select
  (select count(*) from "Centre" where coalesce("isTest", false) = false)                          as centres_total,
  (select count(*) from "Centre" where coalesce("isTest", false) = false and "isActive")           as centres_active,
  (select count(distinct "centreId") from "Quote" where "centreId" in (select id from c))          as centres_with_quotes,
  (select count(distinct "centreId") from "Job"   where "centreId" in (select id from c))          as centres_with_jobs,
  (select count(*) from "Quote" where "centreId" in (select id from c))                            as quotes_total,
  (select min("createdAt") from "Quote" where "centreId" in (select id from c))                    as first_quote,
  (select max("createdAt") from "Quote" where "centreId" in (select id from c))                    as last_quote,
  (select count(*) from "Quote" where "centreId" in (select id from c) and status = 'ACCEPTED')   as quotes_accepted,
  (select count(*) from "Quote" where "centreId" in (select id from c) and "aiConfidence" is not null) as quotes_ai_scored,
  (select count(*) from "Quote" where "centreId" in (select id from c) and "autoApproved")         as quotes_auto_approved,
  (select count(*) from "Job" where "centreId" in (select id from c))                              as jobs_total,
  (select count(*) from "JobStageHistory" h join "Job" j on j.id = h."jobId"
     where j."centreId" in (select id from c))                                                     as stage_transitions,
  (select count(*) from "ReworkEvent" where "centreId" in (select id from c))                      as rework_events,
  (select count(distinct "jobId") from "ReworkEvent" where "centreId" in (select id from c))       as jobs_with_rework,
  (select count(*) from "Job" where "centreId" in (select id from c) and "isReprint")              as reprint_jobs;

-- 2. Quotes and jobs by month (shows pilot ramp since June 2026)
with c as (select id from "Centre" where coalesce("isTest", false) = false)
select to_char(date_trunc('month', "createdAt"), 'YYYY-MM') as month,
       count(*) filter (where true) as quotes
from "Quote" where "centreId" in (select id from c)
group by 1 order by 1;

-- 3. Customer feedback summary and consented testimonials
--    (names and quotes only where the customer consented; confirm with them before publishing)
select count(*) filter (where "submittedAt" is not null)                    as feedback_submitted,
       round(avg("overallRating") filter (where "submittedAt" is not null), 2) as avg_overall_rating,
       round(100.0 * count(*) filter (where "wouldRecommend") /
             nullif(count(*) filter (where "submittedAt" is not null), 0), 1)  as pct_would_recommend,
       count(*) filter (where "testimonialConsent")                         as testimonials_consented
from "CustomerFeedback";

select ce.name as centre, f."overallRating", f."testimonialText", f."customerName", f."submittedAt"
from "CustomerFeedback" f
join "Centre" ce on ce.id = f."centreId"
where f."testimonialConsent" and coalesce(ce."isTest", false) = false
  and f."testimonialText" is not null and length(f."testimonialText") > 20
order by f."overallRating" desc nulls last, f."submittedAt" desc
limit 10;

-- 4. Rework rate and top reasons
with c as (select id from "Centre" where coalesce("isTest", false) = false),
j as (select count(*) n from "Job" where "centreId" in (select id from c)),
r as (select count(distinct "jobId") n from "ReworkEvent" where "centreId" in (select id from c))
select j.n as jobs, r.n as jobs_with_rework, round(100.0 * r.n / nullif(j.n, 0), 2) as rework_rate_pct from j, r;

select "reasonCategory", count(*) from "ReworkEvent"
where "centreId" in (select id from "Centre" where coalesce("isTest", false) = false)
group by 1 order by 2 desc;
