// lib/types.ts - Core TypeScript interfaces for the pipeline

export interface IntelligencePackage {
  summary: string;
  icp: {
    companyTypes: string[];
    companySizes: string[];
    qualifyingCriteria: string[];
    signals: string[];
  };
  salesAngles: SalesAngle[];
  qualificationChecklist: QualificationItem[];
  redFlags: string[];
  namedProspects: NamedProspect[];
  apolloSearches?: ApolloSearchQuery[];
}

export interface SalesAngle {
  name: string;
  hypothesis: string;
  hook: string;
}

export interface QualificationItem {
  criterion: string;
  howToVerify: string;
}

export interface NamedProspect {
  name: string;
  context: string;
  urgencySignal?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ApolloSearchQuery {
  description?: string;
  organization_name?: string;
  employee_count?: string[];
  industry?: string[];
  job_titles?: string[];
  keywords?: string[];
  location?: string[];
}

export interface ProspectResearch {
  prospectName: string;
  
  currentSituation: {
    enrollmentTrends?: string;
    financialHealth?: string;
    recentNews: string[];
    leadershipChanges?: string;
  };
  
  qualificationScore: {
    hasLMS: boolean | null;
    hasAcademicIntegrityPolicy: boolean | null;
    hasAIPolicy: boolean | null;
    hasOnlinePrograms: boolean | null;
    hasWritingIntensivePrograms: boolean | null;
    budgetAuthorityIdentified: boolean | null;
    underEnrollmentPressure: boolean | null;
    hasAccreditationReview: boolean | null;
  };
  
  redFlagsDetected: string[];
  isDisqualified: boolean;
  disqualificationReason?: string;
  
  buyingSignals: BuyingSignal[];
  decisionMakers: DecisionMaker[];
  
  recommendedSalesAngle: string;
  personalizationHooks: string[];
}

export interface BuyingSignal {
  signal: string;
  source: string;
  date?: string;
}

export interface DecisionMaker {
  name?: string;
  title: string;
  source: string;
}

export interface ApolloOrganization {
  id: string;
  name: string;
  domain: string;
  employeeCount: number;
  industry: string;
  location: string;
  linkedinUrl?: string;
}

export interface ApolloPerson {
  id: string;
  name: string;
  title: string;
  email?: string;
  linkedinUrl?: string;
  department?: string;
}

export interface EnrichedProspect {
  id: string;
  name: string;
  domain?: string;
  
  sourceIntelPackage: string;
  discoveryContext: string;
  urgencyLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  
  qualificationScore: ProspectResearch['qualificationScore'];
  fitScore: number;
  isQualified: boolean;
  disqualificationReason?: string;
  
  apolloOrgId?: string;
  employeeCount?: number;
  industry?: string;
  location?: string;
  
  currentSituation: ProspectResearch['currentSituation'];
  buyingSignals: BuyingSignal[];
  redFlags: string[];
  
  recommendedSalesAngle: string;
  personalizationHooks: string[];
  
  primaryContact?: {
    apolloPersonId: string;
    name: string;
    title: string;
    email?: string;
    linkedinUrl?: string;
    selectionRationale: string;
  };
  alternateContacts: ApolloPerson[];
  
  researchedAt: Date;
  reachOutStatus: 'NOT_STARTED' | 'DRAFTED' | 'SENT' | 'RESPONDED' | 'DISQUALIFIED';
  draftedMessage?: DraftedOutreach;
}

export interface DraftedOutreach {
  prospectId: string;
  contactId: string;
  subject: string;
  body: string;
  generatedAt: Date;
  salesAngleUsed: string;
  personalizationHooksUsed: string[];
}
