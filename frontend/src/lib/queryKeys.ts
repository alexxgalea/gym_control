/** Prefix al cheilor de cache ale Jurnalului: un ecran care scrie în Jurnal (ex. Sesiuni manuale) îl invalidează. */
export const JOURNAL_KEY = ["admin", "journal"] as const;
/** Cheia listei Anomaliilor. */
export const ANOMALIES_KEY = ["admin", "anomalies"] as const;
/** Cheia listei Incidentelor. */
export const INCIDENTS_KEY = ["admin", "incidents"] as const;
/** Cheia listei „Acum în Sală”. */
export const IN_HALL_KEY = ["admin", "in-hall"] as const;
