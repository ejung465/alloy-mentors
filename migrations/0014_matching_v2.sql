-- ============================================================================
-- Alloy — Migration 0014: Smart matching v2
-- Pairs a checked-in student with a checked-in volunteer using ONLY:
--   1) Load balance  — fewest students already paired this session (so every
--      present volunteer gets used and nobody is overloaded)
--   2) Continuity    — among those, the volunteer this student has met the most
--      across past sessions
--   3) Random        — if there's no prior history (or a tie), pick at random so
--      students meet new volunteers
-- No language/subject weighting (all speak English). Returns the volunteer id and
-- a short reason. Run after 0001–0013. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_best_volunteer_v2(p_session_id uuid, p_student_id uuid)
RETURNS TABLE (volunteer_id uuid, match_reason text)
LANGUAGE sql VOLATILE AS $$
  WITH checked_in AS (
    SELECT a.volunteer_id AS vid
    FROM public.session_attendance a
    WHERE a.session_id = p_session_id AND a.kind = 'volunteer' AND a.volunteer_id IS NOT NULL
    GROUP BY a.volunteer_id
  ),
  loads AS (
    SELECT paired_volunteer_id AS vid, count(*)::int AS load
    FROM public.session_attendance
    WHERE session_id = p_session_id AND kind = 'student' AND paired_volunteer_id IS NOT NULL
    GROUP BY paired_volunteer_id
  ),
  past AS (
    SELECT paired_volunteer_id AS vid, count(*)::int AS met
    FROM public.session_attendance
    WHERE student_id = p_student_id AND kind = 'student' AND paired_volunteer_id IS NOT NULL
    GROUP BY paired_volunteer_id
  )
  SELECT
    ci.vid AS volunteer_id,
    CASE WHEN coalesce(p.met, 0) > 0 THEN 'Met ' || p.met || '×' ELSE 'New pairing' END AS match_reason
  FROM checked_in ci
  LEFT JOIN loads l ON l.vid = ci.vid
  LEFT JOIN past  p ON p.vid = ci.vid
  ORDER BY
    coalesce(l.load, 0) ASC,   -- 1) load balance across present volunteers
    coalesce(p.met, 0) DESC,   -- 2) continuity: reconnect with a familiar volunteer
    random()                   -- 3) otherwise random, to meet new people
  LIMIT 1;
$$;
