import { useState, useCallback, useEffect, useRef } from "react";

const ANTHROPIC_SYSTEM = `You are a B2B company prospecting intelligence engine for Foxworks Studios, an AI engineering collective. Your job is to identify and qualify eligible TARGET COMPANIES — not individual contacts.

Given a NAICS code and industry description, return a JSON object with this exact structure:
{
  "summary": "2-sentence description of the ideal target company profile",
  "icp": {
    "company_types": ["specific types of companies within this NAICS to prioritize"],
    "company_sizes": ["e.g. '50-200 employees', 'Series A-B', '$5M-$50M revenue'"],
    "qualifying_criteria": ["specific attributes that make a company eligible — e.g. 'has an in-house engineering team', 'uses Salesforce CRM', 'raised funding in last 18 months', 'actively hiring engineers'"],
    "signals": ["observable company-level buying signals — e.g. 'posted AI engineer job listings', 'recently replatformed their stack', 'CTO hired from big tech', 'using OpenAI API based on job postings'"]
  },
  "angles": [
    {
      "name": "company segment name",
      "hypothesis": "why this type of company is a strong fit for AI/MCP tooling",
      "hook": "one-line value prop for this company segment"
    }
  ],
  "searches": {
    "apollo": [
      { "label": "Search name", "query": "Apollo.io COMPANY search description (not people search)", "filters": { "industry": "...", "employee_count": "...", "keywords": "...", "technologies": "...", "person_titles": "titles of people to target within these companies e.g. 'CTO, VP Engineering'", "seniority": "e.g. 'director, vp, c_suite'" } }
    ],
    "google": [
      { "label": "Search name", "query": "exact Google search string to surface target companies" }
    ],
    "linkedin": [
      { "label": "Search name", "query": "LinkedIn company search filter description", "url_hint": "linkedin company search hint" }
    ]
  },
  "qualification_checklist": [
    { "criterion": "specific thing to check about the company", "how_to_verify": "where or how to confirm this criterion" }
  ],
  "red_flags": ["company-level attributes that immediately disqualify them"],
  "enrichment_urls": [
    { "label": "source name", "url": "actual URL", "why": "why this helps find or qualify target companies" }
  ]
}

## Example of exceptional output quality

Input: NAICS 522320 — Financial Transaction Processing (Fintech)

Output:
{"summary":"Series A–C fintech companies ($5M–$80M ARR) that have built payment, lending, or transaction infrastructure and are under pressure to add AI-powered fraud detection, compliance automation, or customer intelligence without expanding their engineering headcount.","icp":{"company_types":["Embedded finance API vendors (banking-as-a-service, lending-as-a-service)","Payment middleware companies connecting merchants to acquirers","Expense management SaaS with card issuance (Brex/Ramp-tier)","Neobanks with proprietary transaction ledgers","Lending platforms doing >$50M/yr origination volume"],"company_sizes":["50–300 employees","Series A–C","$5M–$80M ARR","$10M–$100M raised"],"qualifying_criteria":["Has posted ML engineer, data scientist, or AI engineer job listings in the last 90 days (LinkedIn/Greenhouse)","Engineering team is >20% of total headcount based on LinkedIn employee data","Processes >$1B/year in transaction volume (detectable from press releases or Crunchbase funding context)","Uses Stripe, Plaid, or Marqeta as infrastructure (visible in job postings or tech stack pages)","Has a dedicated compliance or risk team but no AI/ML tooling listed in job requirements"],"signals":["CTO or VP Engineering hired from Stripe, Square, Adyen, or Affirm in last 12 months","Job postings mention 'fraud model', 'transaction scoring', or 'real-time decisioning'","Raised Series B or C in last 18 months — growth pressure to automate ops without hiring","Press coverage of a compliance failure, regulatory fine, or fraud incident in last 24 months","Engineering blog posts about building internal tooling for risk or compliance"]},"angles":[{"name":"Fraud Intelligence Automation","hypothesis":"Payment companies are spending 2–5% of revenue on manual fraud review and are one regulatory cycle away from needing real-time ML decisioning. They have the transaction data but not the ML infrastructure to act on it. Foxworks can build the fraud scoring layer in 8–12 weeks without them needing to hire a ML team.","hook":"Your fraud team is reviewing transactions that an AI model could flag in 40ms — we build that model on your data."},{"name":"Compliance Automation for High-Growth Lenders","hypothesis":"Fintech lenders scaling from $50M to $500M origination volume hit a wall where manual compliance review becomes the growth bottleneck. They need AI to auto-classify, flag, and audit loan files but can't afford to hire a 20-person compliance tech team.","hook":"We turn your compliance backlog from a headcount problem into a model — deployed in weeks, not quarters."}],"searches":{"apollo":[{"label":"Series B Fintech Building Payment Infrastructure","query":"Fintech companies 50-300 employees that process payments or lending, raised Series B, using Stripe or Plaid, actively hiring ML engineers","filters":{"industry":"Financial Services, Fintech","employee_count":"50-300","keywords":"payments, embedded finance, transaction processing, lending platform","technologies":"Stripe, Plaid, Marqeta","person_titles":"CTO, VP Engineering, Head of Data, Head of Risk","seniority":"director, vp, c_suite"}}],"google":[{"label":"Funded Fintech Hiring ML Engineers","query":"site:linkedin.com/jobs \"machine learning engineer\" OR \"fraud model\" fintech payments 2024 2025"}],"linkedin":[{"label":"Fintech Companies 51-200 Employees Using Stripe","query":"Company size: 51-200, Industry: Financial Services, Keywords: payments OR lending OR fintech, Technology: Stripe","url_hint":"LinkedIn Sales Navigator company search: industry=Financial Services, headcount=51-200, keywords=payments+lending"}]},"qualification_checklist":[{"criterion":"Transaction volume > $500M/year","how_to_verify":"Check press releases, Crunchbase, or ask directly — 'what's your current TPV?'"},{"criterion":"Engineering team > 15 people","how_to_verify":"LinkedIn headcount filter: company > filter by 'Engineering' department"},{"criterion":"No current ML/AI vendor relationship","how_to_verify":"Job postings — do they mention existing ML tools like DataRobot, H2O, or internal ML platform?"},{"criterion":"Raised funding in last 24 months","how_to_verify":"Crunchbase funding tab"}],"red_flags":["Already has a dedicated ML platform team of > 5 engineers (will build in-house)","Enterprise bank or credit union (procurement cycles > 12 months, not a fit)","Pre-product or pre-revenue — no transaction data to model against","Primary market is consumer payments at scale (Stripe, PayPal tier — won't outsource core ML)"],"enrichment_urls":[{"label":"Crunchbase Fintech Funding","url":"https://www.crunchbase.com/discover/organizations?facet_ids=category_groups%2Ffinancial-services&funding_total=5000000&last_funding_type=series_b","why":"Filter by funding stage and amount to find companies at the exact growth stage where AI investment makes sense"},{"label":"FinTech Global Company Database","url":"https://fintech.global/directory/","why":"Curated directory of fintech companies by subsector — faster than Apollo for initial vertical mapping"}]}

## Your output must match this quality bar:
- qualifying_criteria must be verifiable from public data (job postings, LinkedIn, press releases) — not assumptions
- signals must be observable without talking to the company — external evidence only
- hooks must be outcome-specific and speak to a business pressure, not a feature
- apollo search filters must be specific enough to return < 500 companies, not thousands

Return ONLY valid JSON. No preamble, no markdown fences.`;

// Curated NAICS codes most relevant to B2B AI/software sales
const SUGGESTED_NAICS = [
  { code: "541511", label: "Custom Software Development" },
  { code: "511210", label: "Software Publishers / SaaS" },
  { code: "541512", label: "Computer Systems Design" },
  { code: "541519", label: "IT Consulting & Services" },
  { code: "518210", label: "Cloud Hosting & Data Processing" },
  { code: "541611", label: "Management Consulting" },
  { code: "522320", label: "Financial Transaction Processing (Fintech)" },
  { code: "523110", label: "Investment Banking & Securities" },
];

const ALL_NAICS = [
  // Technology
  { code: "511210", label: "Software Publishers / SaaS", sector: "Technology" },
  { code: "518210", label: "Cloud Hosting & Data Processing", sector: "Technology" },
  { code: "519130", label: "Internet Publishing & Web Search Portals", sector: "Technology" },
  { code: "519110", label: "News Syndicates & Online Media", sector: "Technology" },
  { code: "541511", label: "Custom Software Development", sector: "Technology" },
  { code: "541512", label: "Computer Systems Design & Integration", sector: "Technology" },
  { code: "541513", label: "Computer Facilities Management Services", sector: "Technology" },
  { code: "541519", label: "IT Consulting & Other Computer Services", sector: "Technology" },
  { code: "517110", label: "Wired Telecom Carriers", sector: "Technology" },
  { code: "517210", label: "Wireless Telecom Carriers", sector: "Technology" },
  { code: "517410", label: "Satellite Telecom", sector: "Technology" },
  { code: "334110", label: "Computer Hardware Manufacturing", sector: "Technology" },
  { code: "334220", label: "Radio & TV Broadcasting Equipment Mfg", sector: "Technology" },
  { code: "334413", label: "Semiconductor & Related Device Mfg", sector: "Technology" },
  { code: "423430", label: "Computer & Peripheral Equipment Wholesale", sector: "Technology" },
  // Finance & Insurance
  { code: "522110", label: "Commercial Banking", sector: "Finance & Insurance" },
  { code: "522120", label: "Savings Institutions", sector: "Finance & Insurance" },
  { code: "522130", label: "Credit Unions", sector: "Finance & Insurance" },
  { code: "522210", label: "Credit Card Issuing", sector: "Finance & Insurance" },
  { code: "522291", label: "Consumer Lending", sector: "Finance & Insurance" },
  { code: "522292", label: "Real Estate Credit (Mortgages)", sector: "Finance & Insurance" },
  { code: "522320", label: "Financial Transaction Processing (Fintech)", sector: "Finance & Insurance" },
  { code: "523110", label: "Investment Banking & Securities Dealing", sector: "Finance & Insurance" },
  { code: "523120", label: "Securities Brokerage", sector: "Finance & Insurance" },
  { code: "523130", label: "Commodity Contracts Dealing", sector: "Finance & Insurance" },
  { code: "523910", label: "Miscellaneous Intermediation (Hedge Funds)", sector: "Finance & Insurance" },
  { code: "523920", label: "Portfolio Management", sector: "Finance & Insurance" },
  { code: "523930", label: "Investment Advice", sector: "Finance & Insurance" },
  { code: "524113", label: "Life Insurance Carriers", sector: "Finance & Insurance" },
  { code: "524114", label: "Health & Medical Insurance Carriers", sector: "Finance & Insurance" },
  { code: "524126", label: "Property & Casualty Insurance Carriers", sector: "Finance & Insurance" },
  { code: "524210", label: "Insurance Agencies & Brokerages", sector: "Finance & Insurance" },
  { code: "525110", label: "Pension Funds", sector: "Finance & Insurance" },
  { code: "525910", label: "Open-End Investment Funds (Mutual Funds)", sector: "Finance & Insurance" },
  { code: "525990", label: "Private Equity & Venture Capital Funds", sector: "Finance & Insurance" },
  // Legal
  { code: "541110", label: "Legal Services / Law Firms", sector: "Legal" },
  { code: "541120", label: "Patent Attorneys", sector: "Legal" },
  { code: "541190", label: "Other Legal Services", sector: "Legal" },
  // Professional Services
  { code: "541211", label: "CPA Firms & Public Accounting", sector: "Professional Services" },
  { code: "541213", label: "Tax Preparation Services", sector: "Professional Services" },
  { code: "541214", label: "Payroll Services", sector: "Professional Services" },
  { code: "541219", label: "Other Accounting Services", sector: "Professional Services" },
  { code: "541310", label: "Architectural Services", sector: "Professional Services" },
  { code: "541320", label: "Landscape Architectural Services", sector: "Professional Services" },
  { code: "541330", label: "Engineering Services", sector: "Professional Services" },
  { code: "541340", label: "Drafting Services", sector: "Professional Services" },
  { code: "541350", label: "Building Inspection Services", sector: "Professional Services" },
  { code: "541360", label: "Geophysical Surveying", sector: "Professional Services" },
  { code: "541380", label: "Testing Laboratories", sector: "Professional Services" },
  { code: "541611", label: "Management Consulting", sector: "Professional Services" },
  { code: "541612", label: "HR Consulting", sector: "Professional Services" },
  { code: "541613", label: "Marketing Consulting", sector: "Professional Services" },
  { code: "541614", label: "Process & Logistics Consulting", sector: "Professional Services" },
  { code: "541618", label: "Other Management Consulting", sector: "Professional Services" },
  { code: "541620", label: "Environmental Consulting", sector: "Professional Services" },
  { code: "541690", label: "Other Scientific & Technical Consulting", sector: "Professional Services" },
  { code: "541710", label: "Physical, Engineering & Life Sciences R&D", sector: "Professional Services" },
  { code: "541720", label: "Social Science & Humanities R&D", sector: "Professional Services" },
  { code: "541910", label: "Market Research & Polling", sector: "Professional Services" },
  { code: "541921", label: "Photography Studios, Portrait", sector: "Professional Services" },
  { code: "541990", label: "Other Professional & Technical Services", sector: "Professional Services" },
  // Marketing & Advertising
  { code: "541810", label: "Advertising Agencies", sector: "Marketing & Advertising" },
  { code: "541820", label: "Public Relations Agencies", sector: "Marketing & Advertising" },
  { code: "541830", label: "Media Buying Agencies", sector: "Marketing & Advertising" },
  { code: "541840", label: "Media Representatives", sector: "Marketing & Advertising" },
  { code: "541850", label: "Outdoor Advertising", sector: "Marketing & Advertising" },
  { code: "541860", label: "Direct Mail Advertising", sector: "Marketing & Advertising" },
  { code: "541870", label: "Advertising Material Distribution", sector: "Marketing & Advertising" },
  { code: "541890", label: "Other Advertising Services", sector: "Marketing & Advertising" },
  // Healthcare
  { code: "621111", label: "Offices of Physicians (General)", sector: "Healthcare" },
  { code: "621112", label: "Offices of Physicians (Mental Health)", sector: "Healthcare" },
  { code: "621210", label: "Offices of Dentists", sector: "Healthcare" },
  { code: "621310", label: "Offices of Chiropractors", sector: "Healthcare" },
  { code: "621320", label: "Offices of Optometrists", sector: "Healthcare" },
  { code: "621330", label: "Mental Health Practitioners", sector: "Healthcare" },
  { code: "621340", label: "Offices of Physical Therapists", sector: "Healthcare" },
  { code: "621399", label: "All Other Health Practitioners", sector: "Healthcare" },
  { code: "621410", label: "Family Planning Centers", sector: "Healthcare" },
  { code: "621420", label: "Outpatient Mental Health Centers", sector: "Healthcare" },
  { code: "621491", label: "HMO Medical Centers", sector: "Healthcare" },
  { code: "621498", label: "Urgent Care Centers", sector: "Healthcare" },
  { code: "621511", label: "Medical Labs & Diagnostic Imaging", sector: "Healthcare" },
  { code: "621610", label: "Home Health Care Services", sector: "Healthcare" },
  { code: "621910", label: "Ambulance Services", sector: "Healthcare" },
  { code: "622110", label: "General Medical & Surgical Hospitals", sector: "Healthcare" },
  { code: "622210", label: "Psychiatric & Substance Abuse Hospitals", sector: "Healthcare" },
  { code: "622310", label: "Specialty Hospitals", sector: "Healthcare" },
  { code: "623110", label: "Nursing Care Facilities", sector: "Healthcare" },
  { code: "623210", label: "Residential Intellectual Disability Facilities", sector: "Healthcare" },
  { code: "623311", label: "Continuing Care Retirement Communities", sector: "Healthcare" },
  { code: "624110", label: "Child & Youth Services", sector: "Healthcare" },
  { code: "624120", label: "Services for the Elderly & Disabled", sector: "Healthcare" },
  { code: "624190", label: "Mental Health & Substance Abuse Services", sector: "Healthcare" },
  // Real Estate
  { code: "531110", label: "Lessors of Residential Buildings", sector: "Real Estate" },
  { code: "531120", label: "Commercial Real Estate Lessors", sector: "Real Estate" },
  { code: "531130", label: "Lessors of Mini-Warehouses & Self-Storage", sector: "Real Estate" },
  { code: "531190", label: "Lessors of Other Real Estate", sector: "Real Estate" },
  { code: "531210", label: "Real Estate Agents & Brokers", sector: "Real Estate" },
  { code: "531311", label: "Residential Property Management", sector: "Real Estate" },
  { code: "531312", label: "Nonresidential Property Management", sector: "Real Estate" },
  { code: "531320", label: "Real Estate Appraisers", sector: "Real Estate" },
  { code: "531390", label: "Other Activities Related to Real Estate", sector: "Real Estate" },
  // Construction
  { code: "236110", label: "Residential Building Construction", sector: "Construction" },
  { code: "236115", label: "New Single-Family Home Construction", sector: "Construction" },
  { code: "236116", label: "New Multifamily Housing Construction", sector: "Construction" },
  { code: "236220", label: "Commercial & Institutional Building Construction", sector: "Construction" },
  { code: "237110", label: "Water & Sewer Line Construction", sector: "Construction" },
  { code: "237120", label: "Oil & Gas Pipeline Construction", sector: "Construction" },
  { code: "237130", label: "Power & Communication Line Construction", sector: "Construction" },
  { code: "237310", label: "Highway, Street & Bridge Construction", sector: "Construction" },
  { code: "237990", label: "Other Heavy & Civil Engineering Construction", sector: "Construction" },
  { code: "238110", label: "Poured Concrete Foundation Contractors", sector: "Construction" },
  { code: "238160", label: "Roofing Contractors", sector: "Construction" },
  { code: "238210", label: "Electrical Contractors", sector: "Construction" },
  { code: "238220", label: "Plumbing, Heating & HVAC Contractors", sector: "Construction" },
  { code: "238290", label: "Other Building Equipment Contractors", sector: "Construction" },
  { code: "238310", label: "Drywall & Insulation Contractors", sector: "Construction" },
  { code: "238320", label: "Painting & Wall Covering Contractors", sector: "Construction" },
  { code: "238330", label: "Flooring Contractors", sector: "Construction" },
  { code: "238910", label: "Site Preparation Contractors", sector: "Construction" },
  { code: "238990", label: "Other Specialty Trade Contractors", sector: "Construction" },
  // Logistics & Transportation
  { code: "481110", label: "Scheduled Air Transportation", sector: "Logistics & Transportation" },
  { code: "481210", label: "Nonscheduled Air Transportation", sector: "Logistics & Transportation" },
  { code: "482110", label: "Rail Transportation", sector: "Logistics & Transportation" },
  { code: "483110", label: "Deep Sea Freight Transportation", sector: "Logistics & Transportation" },
  { code: "484110", label: "General Freight Trucking — Local", sector: "Logistics & Transportation" },
  { code: "484121", label: "General Freight Trucking — Long-Distance", sector: "Logistics & Transportation" },
  { code: "484210", label: "Used Household & Office Goods Moving", sector: "Logistics & Transportation" },
  { code: "484220", label: "Specialized Freight (Agriculture)", sector: "Logistics & Transportation" },
  { code: "485110", label: "Urban Transit Systems", sector: "Logistics & Transportation" },
  { code: "485410", label: "School & Employee Bus Transportation", sector: "Logistics & Transportation" },
  { code: "485510", label: "Charter Bus Industry", sector: "Logistics & Transportation" },
  { code: "485999", label: "All Other Transit & Ground Passenger Transport", sector: "Logistics & Transportation" },
  { code: "488510", label: "Freight Transportation Arrangement (3PL)", sector: "Logistics & Transportation" },
  { code: "488991", label: "Packing & Crating Services", sector: "Logistics & Transportation" },
  { code: "492110", label: "Couriers & Express Delivery Services", sector: "Logistics & Transportation" },
  { code: "492210", label: "Local Messengers & Local Delivery", sector: "Logistics & Transportation" },
  { code: "493110", label: "General Warehousing & Storage", sector: "Logistics & Transportation" },
  { code: "493120", label: "Refrigerated Warehousing & Storage", sector: "Logistics & Transportation" },
  { code: "493190", label: "Other Warehousing & Storage", sector: "Logistics & Transportation" },
  // HR & Staffing
  { code: "561110", label: "Office Administrative Services", sector: "HR & Staffing" },
  { code: "561210", label: "Facilities Support Services", sector: "HR & Staffing" },
  { code: "561310", label: "Employment Placement Agencies", sector: "HR & Staffing" },
  { code: "561311", label: "Temporary Staffing Agencies", sector: "HR & Staffing" },
  { code: "561312", label: "Executive Search Firms", sector: "HR & Staffing" },
  { code: "561320", label: "PEO & Payroll Services", sector: "HR & Staffing" },
  { code: "561330", label: "Professional Employer Organizations (PEO)", sector: "HR & Staffing" },
  { code: "561410", label: "Document Preparation Services", sector: "HR & Staffing" },
  { code: "561421", label: "Telephone Answering Services", sector: "HR & Staffing" },
  { code: "561422", label: "Telemarketing Bureaus & Call Centers", sector: "HR & Staffing" },
  { code: "561499", label: "Business Process Outsourcing (BPO)", sector: "HR & Staffing" },
  { code: "561611", label: "Investigation, Guard & Armored Car Services", sector: "HR & Staffing" },
  { code: "561612", label: "Security Systems Services", sector: "HR & Staffing" },
  // Education
  { code: "611110", label: "Elementary & Secondary Schools", sector: "Education" },
  { code: "611210", label: "Junior Colleges", sector: "Education" },
  { code: "611310", label: "Colleges, Universities & Professional Schools", sector: "Education" },
  { code: "611410", label: "Business & Secretarial Schools", sector: "Education" },
  { code: "611420", label: "Computer Training Centers", sector: "Education" },
  { code: "611430", label: "Professional & Management Development Training", sector: "Education" },
  { code: "611511", label: "Cosmetology & Barber Schools", sector: "Education" },
  { code: "611519", label: "Other Technical & Trade Schools", sector: "Education" },
  { code: "611620", label: "Sports & Recreation Instruction", sector: "Education" },
  { code: "611630", label: "Language Schools", sector: "Education" },
  { code: "611699", label: "All Other Miscellaneous Schools", sector: "Education" },
  { code: "611710", label: "Educational Support Services", sector: "Education" },
  // Hospitality & Food Service
  { code: "721110", label: "Hotels & Motels", sector: "Hospitality & Food Service" },
  { code: "721120", label: "Casino Hotels", sector: "Hospitality & Food Service" },
  { code: "721191", label: "Bed-and-Breakfast Inns", sector: "Hospitality & Food Service" },
  { code: "721199", label: "All Other Traveler Accommodation", sector: "Hospitality & Food Service" },
  { code: "721211", label: "RV Parks & Recreational Camps", sector: "Hospitality & Food Service" },
  { code: "721310", label: "Rooming & Boarding Houses", sector: "Hospitality & Food Service" },
  { code: "722310", label: "Food Service Contractors", sector: "Hospitality & Food Service" },
  { code: "722320", label: "Caterers", sector: "Hospitality & Food Service" },
  { code: "722330", label: "Mobile Food Services", sector: "Hospitality & Food Service" },
  { code: "722410", label: "Drinking Places (Bars & Nightclubs)", sector: "Hospitality & Food Service" },
  { code: "722511", label: "Full-Service Restaurants", sector: "Hospitality & Food Service" },
  { code: "722513", label: "Limited-Service Restaurants / Fast Food", sector: "Hospitality & Food Service" },
  { code: "722514", label: "Cafeterias, Grill Buffets & Buffets", sector: "Hospitality & Food Service" },
  { code: "722515", label: "Snack & Nonalcoholic Beverage Bars", sector: "Hospitality & Food Service" },
  // Manufacturing
  { code: "311110", label: "Animal Food Manufacturing", sector: "Manufacturing" },
  { code: "311210", label: "Flour Milling", sector: "Manufacturing" },
  { code: "311300", label: "Sugar & Confectionery Manufacturing", sector: "Manufacturing" },
  { code: "311410", label: "Frozen Food Manufacturing", sector: "Manufacturing" },
  { code: "311500", label: "Dairy Product Manufacturing", sector: "Manufacturing" },
  { code: "311610", label: "Animal Slaughtering & Processing", sector: "Manufacturing" },
  { code: "311810", label: "Bread & Bakery Product Manufacturing", sector: "Manufacturing" },
  { code: "311910", label: "Snack Food Manufacturing", sector: "Manufacturing" },
  { code: "312110", label: "Soft Drink & Ice Manufacturing", sector: "Manufacturing" },
  { code: "312120", label: "Breweries", sector: "Manufacturing" },
  { code: "312130", label: "Wineries", sector: "Manufacturing" },
  { code: "312140", label: "Distilleries", sector: "Manufacturing" },
  { code: "312200", label: "Tobacco Manufacturing", sector: "Manufacturing" },
  { code: "315000", label: "Apparel Manufacturing", sector: "Manufacturing" },
  { code: "321000", label: "Wood Product Manufacturing", sector: "Manufacturing" },
  { code: "322000", label: "Paper Manufacturing", sector: "Manufacturing" },
  { code: "325110", label: "Petrochemical Manufacturing", sector: "Manufacturing" },
  { code: "325120", label: "Industrial Gas Manufacturing", sector: "Manufacturing" },
  { code: "325200", label: "Resin & Synthetic Material Manufacturing", sector: "Manufacturing" },
  { code: "325412", label: "Pharmaceutical Preparation Manufacturing", sector: "Manufacturing" },
  { code: "325413", label: "In-Vitro Diagnostic Substance Manufacturing", sector: "Manufacturing" },
  { code: "325414", label: "Biological Product Manufacturing", sector: "Manufacturing" },
  { code: "325500", label: "Paint, Coating & Adhesive Manufacturing", sector: "Manufacturing" },
  { code: "325600", label: "Soap, Cleaning Compound & Toilet Prep Mfg", sector: "Manufacturing" },
  { code: "326100", label: "Plastics Product Manufacturing", sector: "Manufacturing" },
  { code: "326200", label: "Rubber Product Manufacturing", sector: "Manufacturing" },
  { code: "327000", label: "Nonmetallic Mineral Product Manufacturing", sector: "Manufacturing" },
  { code: "331000", label: "Primary Metal Manufacturing", sector: "Manufacturing" },
  { code: "332000", label: "Fabricated Metal Product Manufacturing", sector: "Manufacturing" },
  { code: "333000", label: "Industrial Machinery Manufacturing", sector: "Manufacturing" },
  { code: "333310", label: "Commercial & Service Industry Machinery Mfg", sector: "Manufacturing" },
  { code: "333510", label: "Metalworking Machinery Manufacturing", sector: "Manufacturing" },
  { code: "333610", label: "Engine, Turbine & Power Transmission Mfg", sector: "Manufacturing" },
  { code: "334210", label: "Telephone Apparatus Manufacturing", sector: "Manufacturing" },
  { code: "334290", label: "Other Communications Equipment Mfg", sector: "Manufacturing" },
  { code: "334310", label: "Audio & Video Equipment Manufacturing", sector: "Manufacturing" },
  { code: "334500", label: "Navigational, Measuring & Electromedical Mfg", sector: "Manufacturing" },
  { code: "335000", label: "Electrical Equipment & Appliance Manufacturing", sector: "Manufacturing" },
  { code: "336110", label: "Automobile & Light Truck Manufacturing", sector: "Manufacturing" },
  { code: "336120", label: "Heavy Duty Truck Manufacturing", sector: "Manufacturing" },
  { code: "336411", label: "Aircraft Manufacturing", sector: "Manufacturing" },
  { code: "336510", label: "Railroad Rolling Stock Manufacturing", sector: "Manufacturing" },
  { code: "337000", label: "Furniture & Related Product Manufacturing", sector: "Manufacturing" },
  { code: "339100", label: "Medical Equipment & Supplies Manufacturing", sector: "Manufacturing" },
  { code: "339910", label: "Jewelry Manufacturing", sector: "Manufacturing" },
  // Wholesale Trade
  { code: "423100", label: "Motor Vehicle & Parts Wholesale", sector: "Wholesale Trade" },
  { code: "423300", label: "Lumber & Construction Materials Wholesale", sector: "Wholesale Trade" },
  { code: "423400", label: "Professional & Commercial Equipment Wholesale", sector: "Wholesale Trade" },
  { code: "423440", label: "Other Computer & Electronics Wholesale", sector: "Wholesale Trade" },
  { code: "423600", label: "Electrical Apparatus & Equipment Wholesale", sector: "Wholesale Trade" },
  { code: "423700", label: "Hardware & Plumbing Equipment Wholesale", sector: "Wholesale Trade" },
  { code: "423800", label: "Machinery & Supply Merchant Wholesale", sector: "Wholesale Trade" },
  { code: "423990", label: "Other Durable Goods Wholesale", sector: "Wholesale Trade" },
  { code: "424100", label: "Paper & Paper Products Wholesale", sector: "Wholesale Trade" },
  { code: "424400", label: "Grocery & Related Product Wholesale", sector: "Wholesale Trade" },
  { code: "424500", label: "Farm Product Raw Material Wholesale", sector: "Wholesale Trade" },
  { code: "424700", label: "Petroleum & Petroleum Products Wholesale", sector: "Wholesale Trade" },
  { code: "424900", label: "Miscellaneous Non-Durable Goods Wholesale", sector: "Wholesale Trade" },
  // E-commerce & Retail
  { code: "441110", label: "New Car Dealers", sector: "E-commerce & Retail" },
  { code: "441120", label: "Used Car Dealers", sector: "E-commerce & Retail" },
  { code: "441210", label: "Recreational Vehicle Dealers", sector: "E-commerce & Retail" },
  { code: "442110", label: "Furniture Stores", sector: "E-commerce & Retail" },
  { code: "443141", label: "Household Appliance Stores", sector: "E-commerce & Retail" },
  { code: "443142", label: "Electronics Stores", sector: "E-commerce & Retail" },
  { code: "444110", label: "Home Centers (Home Depot / Lowes type)", sector: "E-commerce & Retail" },
  { code: "445110", label: "Supermarkets & Grocery Stores", sector: "E-commerce & Retail" },
  { code: "446110", label: "Pharmacies & Drug Stores", sector: "E-commerce & Retail" },
  { code: "447110", label: "Gasoline Stations with Convenience Stores", sector: "E-commerce & Retail" },
  { code: "448110", label: "Men's Clothing Stores", sector: "E-commerce & Retail" },
  { code: "448120", label: "Women's Clothing Stores", sector: "E-commerce & Retail" },
  { code: "448210", label: "Shoe Stores", sector: "E-commerce & Retail" },
  { code: "451110", label: "Sporting Goods Stores", sector: "E-commerce & Retail" },
  { code: "451211", label: "Book Stores", sector: "E-commerce & Retail" },
  { code: "452210", label: "Department Stores", sector: "E-commerce & Retail" },
  { code: "452311", label: "Warehouse Clubs & Supercenters", sector: "E-commerce & Retail" },
  { code: "453110", label: "Florists", sector: "E-commerce & Retail" },
  { code: "453210", label: "Office Supplies & Stationery Stores", sector: "E-commerce & Retail" },
  { code: "453910", label: "Pet & Pet Supplies Stores", sector: "E-commerce & Retail" },
  { code: "453920", label: "Art Dealers", sector: "E-commerce & Retail" },
  { code: "454110", label: "Electronic Shopping / E-commerce", sector: "E-commerce & Retail" },
  { code: "454210", label: "Vending Machine Operators", sector: "E-commerce & Retail" },
  { code: "454310", label: "Fuel Dealers (Heating Oil, Propane)", sector: "E-commerce & Retail" },
  // Media & Publishing
  { code: "511110", label: "Newspaper Publishers", sector: "Media & Publishing" },
  { code: "511120", label: "Periodical Publishers (Magazines)", sector: "Media & Publishing" },
  { code: "511130", label: "Book Publishers", sector: "Media & Publishing" },
  { code: "511140", label: "Directory & Mailing List Publishers", sector: "Media & Publishing" },
  { code: "511190", label: "Other Publishers", sector: "Media & Publishing" },
  { code: "512110", label: "Motion Picture & Video Production", sector: "Media & Publishing" },
  { code: "512120", label: "Motion Picture & Video Distribution", sector: "Media & Publishing" },
  { code: "512131", label: "Motion Picture Theaters", sector: "Media & Publishing" },
  { code: "512199", label: "Postproduction & Other Motion Picture Services", sector: "Media & Publishing" },
  { code: "512230", label: "Music Publishers", sector: "Media & Publishing" },
  { code: "512240", label: "Sound Recording Studios", sector: "Media & Publishing" },
  { code: "515110", label: "Radio Broadcasting", sector: "Media & Publishing" },
  { code: "515120", label: "Television Broadcasting", sector: "Media & Publishing" },
  { code: "515210", label: "Cable & Subscription TV", sector: "Media & Publishing" },
  // Energy & Cleantech
  { code: "211120", label: "Crude Petroleum Extraction", sector: "Energy & Cleantech" },
  { code: "211130", label: "Natural Gas Extraction", sector: "Energy & Cleantech" },
  { code: "213112", label: "Oil & Gas Field Services", sector: "Energy & Cleantech" },
  { code: "221111", label: "Hydroelectric Power Generation", sector: "Energy & Cleantech" },
  { code: "221112", label: "Fossil Fuel Electric Power Generation", sector: "Energy & Cleantech" },
  { code: "221113", label: "Nuclear Electric Power Generation", sector: "Energy & Cleantech" },
  { code: "221114", label: "Solar Electric Power Generation", sector: "Energy & Cleantech" },
  { code: "221115", label: "Wind Electric Power Generation", sector: "Energy & Cleantech" },
  { code: "221116", label: "Geothermal Electric Power Generation", sector: "Energy & Cleantech" },
  { code: "221117", label: "Biomass Electric Power Generation", sector: "Energy & Cleantech" },
  { code: "221118", label: "Other Electric Power Generation", sector: "Energy & Cleantech" },
  { code: "221121", label: "Electric Bulk Power Transmission & Control", sector: "Energy & Cleantech" },
  { code: "221122", label: "Electric Power Distribution", sector: "Energy & Cleantech" },
  { code: "221210", label: "Natural Gas Distribution", sector: "Energy & Cleantech" },
  { code: "221310", label: "Water Supply & Irrigation Systems", sector: "Energy & Cleantech" },
  { code: "221320", label: "Sewage Treatment Facilities", sector: "Energy & Cleantech" },
  { code: "541620", label: "Environmental Consulting Services", sector: "Energy & Cleantech" },
  // Agriculture
  { code: "111110", label: "Soybean Farming", sector: "Agriculture" },
  { code: "111140", label: "Wheat Farming", sector: "Agriculture" },
  { code: "111150", label: "Corn Farming", sector: "Agriculture" },
  { code: "111210", label: "Vegetable & Melon Farming", sector: "Agriculture" },
  { code: "111310", label: "Orange Groves", sector: "Agriculture" },
  { code: "111331", label: "Apple Orchards", sector: "Agriculture" },
  { code: "111419", label: "Other Food Crops Grown Under Cover", sector: "Agriculture" },
  { code: "111920", label: "Cotton Farming", sector: "Agriculture" },
  { code: "112110", label: "Beef Cattle Ranching & Farming", sector: "Agriculture" },
  { code: "112120", label: "Dairy Cattle & Milk Production", sector: "Agriculture" },
  { code: "112210", label: "Hog & Pig Farming", sector: "Agriculture" },
  { code: "112300", label: "Poultry & Egg Production", sector: "Agriculture" },
  { code: "112510", label: "Aquaculture", sector: "Agriculture" },
  { code: "114110", label: "Fishing", sector: "Agriculture" },
  { code: "115110", label: "Agricultural Support Activities for Crops", sector: "Agriculture" },
  { code: "115210", label: "Support Activities for Animal Production", sector: "Agriculture" },
  { code: "115310", label: "Support Activities for Forestry", sector: "Agriculture" },
  // Mining & Resources
  { code: "211110", label: "Oil & Gas Extraction", sector: "Mining & Resources" },
  { code: "212111", label: "Bituminous Coal & Lignite Surface Mining", sector: "Mining & Resources" },
  { code: "212210", label: "Iron Ore Mining", sector: "Mining & Resources" },
  { code: "212221", label: "Gold & Silver Ore Mining", sector: "Mining & Resources" },
  { code: "212234", label: "Copper Ore & Nickel Ore Mining", sector: "Mining & Resources" },
  { code: "212319", label: "Crushed & Broken Stone Mining & Quarrying", sector: "Mining & Resources" },
  { code: "212321", label: "Construction Sand & Gravel Mining", sector: "Mining & Resources" },
  { code: "213111", label: "Drilling Oil & Gas Wells", sector: "Mining & Resources" },
  // Arts & Entertainment
  { code: "711110", label: "Theater Companies & Dinner Theaters", sector: "Arts & Entertainment" },
  { code: "711130", label: "Musical Groups & Artists", sector: "Arts & Entertainment" },
  { code: "711211", label: "Sports Teams & Clubs", sector: "Arts & Entertainment" },
  { code: "711310", label: "Promoters of Performing Arts & Sports Events", sector: "Arts & Entertainment" },
  { code: "711410", label: "Agents & Managers for Artists & Athletes", sector: "Arts & Entertainment" },
  { code: "711510", label: "Independent Artists, Writers & Performers", sector: "Arts & Entertainment" },
  { code: "712110", label: "Museums", sector: "Arts & Entertainment" },
  { code: "713110", label: "Amusement & Theme Parks", sector: "Arts & Entertainment" },
  { code: "713210", label: "Casinos (Except Casino Hotels)", sector: "Arts & Entertainment" },
  { code: "713910", label: "Golf Courses & Country Clubs", sector: "Arts & Entertainment" },
  { code: "713940", label: "Fitness & Recreational Sports Centers", sector: "Arts & Entertainment" },
  { code: "713950", label: "Bowling Centers", sector: "Arts & Entertainment" },
  { code: "713990", label: "All Other Amusement & Recreation Industries", sector: "Arts & Entertainment" },
  // Other Services
  { code: "811110", label: "General Automotive Repair", sector: "Other Services" },
  { code: "811121", label: "Automotive Body, Paint & Interior Repair", sector: "Other Services" },
  { code: "811192", label: "Car Washes", sector: "Other Services" },
  { code: "811210", label: "Electronic & Precision Equipment Repair", sector: "Other Services" },
  { code: "811310", label: "Commercial & Industrial Machinery Repair", sector: "Other Services" },
  { code: "812110", label: "Barber Shops", sector: "Other Services" },
  { code: "812112", label: "Beauty Salons", sector: "Other Services" },
  { code: "812113", label: "Nail Salons", sector: "Other Services" },
  { code: "812210", label: "Funeral Homes & Funeral Services", sector: "Other Services" },
  { code: "812310", label: "Coin-Operated Laundries & Drycleaners", sector: "Other Services" },
  { code: "812320", label: "Drycleaning & Laundry Services", sector: "Other Services" },
  { code: "812910", label: "Pet Care Services (Boarding & Grooming)", sector: "Other Services" },
  { code: "812990", label: "All Other Personal Services", sector: "Other Services" },
  { code: "813110", label: "Religious Organizations", sector: "Other Services" },
  { code: "813210", label: "Grantmaking Foundations", sector: "Other Services" },
  { code: "813410", label: "Civic & Social Organizations", sector: "Other Services" },
  { code: "813910", label: "Business Associations", sector: "Other Services" },
  { code: "813920", label: "Professional Organizations", sector: "Other Services" },
  // Government & Public Sector
  { code: "921110", label: "Executive Offices (Federal)", sector: "Government & Public Sector" },
  { code: "921120", label: "Legislative Bodies", sector: "Government & Public Sector" },
  { code: "921130", label: "Public Finance Activities", sector: "Government & Public Sector" },
  { code: "922110", label: "Courts", sector: "Government & Public Sector" },
  { code: "922120", label: "Police Protection", sector: "Government & Public Sector" },
  { code: "922130", label: "Legal Counsel & Prosecution", sector: "Government & Public Sector" },
  { code: "922140", label: "Correctional Institutions", sector: "Government & Public Sector" },
  { code: "923110", label: "Social Assistance Administration", sector: "Government & Public Sector" },
  { code: "924110", label: "Air, Water & Solid Waste Management", sector: "Government & Public Sector" },
  { code: "925110", label: "Administration of Housing Programs", sector: "Government & Public Sector" },
  { code: "926110", label: "Administration of General Economic Programs", sector: "Government & Public Sector" },
  { code: "926120", label: "Regulation & Administration of Transportation", sector: "Government & Public Sector" },
  { code: "926130", label: "Regulation & Administration of Communications", sector: "Government & Public Sector" },
  { code: "926140", label: "Regulation of Agricultural Markets & Inputs", sector: "Government & Public Sector" },
  { code: "927110", label: "Space Research & Technology", sector: "Government & Public Sector" },
  { code: "928110", label: "National Security", sector: "Government & Public Sector" },
  { code: "928120", label: "International Affairs", sector: "Government & Public Sector" },
];

const SIZES = ["1–10", "11–50", "51–200", "201–500", "500–1000", "1000+"];

// ── Shared design tokens (EventFold-inspired light theme) ─────────────────────
const T = {
  bg:          "#f8fafc",
  surface:     "#ffffff",
  border:      "#e2e8f0",
  borderFocus: "#a5b4fc",
  text:        "#0f172a",
  textSub:     "#475569",
  textMuted:   "#94a3b8",
  accent:      "#4F46E5",
  accentHover: "#4338CA",
  accentBg:    "#EEF2FF",
  accentBorder:"#C7D2FE",
  green:       "#059669",
  greenBg:     "#ECFDF5",
  greenBorder: "#A7F3D0",
  amber:       "#D97706",
  amberBg:     "#FFFBEB",
  amberBorder: "#FDE68A",
  red:         "#DC2626",
  redBg:       "#FEF2F2",
  redBorder:   "#FECACA",
  violet:      "#7C3AED",
  violetBg:    "#F5F3FF",
  violetBorder:"#DDD6FE",
  pink:        "#DB2777",
  pinkBg:      "#FDF2F8",
  pinkBorder:  "#FBCFE8",
  shadow:      "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:    "0 4px 6px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04)",
  radius:      8,
  radiusSm:    6,
};

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Export helpers ────────────────────────────────────────────────────────────
function exportJSON(result, naicsCode, naicsLabel) {
  const payload = {
    meta: { version: 1, naicsCode, naicsLabel, generated: new Date().toISOString() },
    ...result,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prospect-${naicsCode}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildMarkdown(result, naicsCode, naicsLabel) {
  const lines = [];
  lines.push(`# Prospect Intel: ${naicsLabel} (${naicsCode})`);
  lines.push(`_Generated ${new Date().toLocaleDateString()}_\n`);
  lines.push(`## Summary\n${result.summary}\n`);

  if (result.icp?.company_types?.length) {
    lines.push(`## Company Types\n${result.icp.company_types.map(t => `- ${t}`).join("\n")}\n`);
  }
  if (result.icp?.qualifying_criteria?.length) {
    lines.push(`## Qualifying Criteria\n${result.icp.qualifying_criteria.map(c => `- [ ] ${c}`).join("\n")}\n`);
  }
  if (result.icp?.signals?.length) {
    lines.push(`## Buying Signals\n${result.icp.signals.map(s => `- ${s}`).join("\n")}\n`);
  }
  if (result.angles?.length) {
    lines.push("## Angles");
    result.angles.forEach((a, i) => {
      lines.push(`### ${i + 1}. ${a.name}\n${a.hypothesis}\n> "${a.hook}"\n`);
    });
  }
  if (result.searches?.apollo?.length) {
    lines.push("## Apollo Searches");
    result.searches.apollo.forEach(s => {
      lines.push(`### ${s.label}\n\`${s.query}\``);
      if (s.filters) {
        const f = Object.entries(s.filters).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(" · ");
        if (f) lines.push(`_${f}_`);
      }
      lines.push("");
    });
  }
  if (result.qualification_checklist?.length) {
    lines.push(`## Qualification Checklist\n${result.qualification_checklist.map(i => `- [ ] **${i.criterion}** — ${i.how_to_verify}`).join("\n")}\n`);
  }
  if (result.red_flags?.length) {
    lines.push(`## Red Flags\n${result.red_flags.map(f => `- ❌ ${f}`).join("\n")}\n`);
  }
  return lines.join("\n");
}

function CopyButton({ text, label = "COPY", successLabel = "✓ COPIED" }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button onClick={copy} style={{
      background: copied ? T.greenBg : T.surface,
      border: `1px solid ${copied ? T.greenBorder : T.border}`,
      color: copied ? T.green : T.textSub,
      borderRadius: T.radiusSm,
      padding: "3px 10px",
      fontSize: 11,
      fontWeight: 600,
      cursor: "pointer",
      transition: "all 0.15s",
      letterSpacing: "0.04em",
      fontFamily: "inherit",
    }}>
      {copied ? successLabel : label}
    </button>
  );
}

function Tag({ children, color = T.accent, bg = T.accentBg, border = T.accentBorder }) {
  return (
    <span style={{
      background: bg,
      color,
      border: `1px solid ${border}`,
      borderRadius: 4,
      padding: "3px 9px",
      fontSize: 12,
      fontWeight: 500,
      display: "inline-block",
      margin: "2px 3px 2px 0",
    }}>{children}</span>
  );
}

function Section({ title, accent = T.accent, accentBg = T.accentBg, accentBorder = T.accentBorder, children }) {
  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: T.radius,
      padding: "18px 20px",
      marginBottom: 12,
      boxShadow: T.shadow,
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.1em",
        color: accent,
        marginBottom: 14,
        textTransform: "uppercase",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        <span style={{ display: "inline-block", width: 3, height: 14, background: accent, borderRadius: 2 }} />
        {title}
      </div>
      {children}
    </div>
  );
}

function SearchCard({ item, platform, apolloKey }) {
  const cfg = {
    apollo:   { color: T.amber,  bg: T.amberBg,  border: T.amberBorder  },
    google:   { color: T.green,  bg: T.greenBg,  border: T.greenBorder  },
    linkedin: { color: T.accent, bg: T.accentBg, border: T.accentBorder },
  };
  const { color, bg, border } = cfg[platform] || { color: T.text, bg: T.surface, border: T.border };

  const [liveResults, setLiveResults] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState(null);

  const searchLive = async () => {
    if (!apolloKey?.trim()) { setLiveError("Add your Apollo API key first."); return; }
    setLiveLoading(true); setLiveError(null); setLiveResults(null);
    try {
      const api = window.electronAPI;
      if (!api?.searchApolloCompanies) throw new Error("Run in the desktop app to use live search.");
      const res = await api.searchApolloCompanies({ apiKey: apolloKey, filters: item.filters || {} });
      setLiveResults(res);
    } catch (e) {
      setLiveError(e.message || "Apollo search failed.");
    } finally {
      setLiveLoading(false);
    }
  };

  const [copiedToEF, setCopiedToEF] = useState(false);

  const sendToEventFold = async () => {
    const payload = JSON.stringify({
      __prospect_intel: true,
      industry:  item.filters?.industry       || "",
      titles:    item.filters?.person_titles  || "",
      seniority: item.filters?.seniority      || "",
      keywords:  item.filters?.keywords       || "",
    });
    await navigator.clipboard.writeText(payload);
    setCopiedToEF(true);
    setTimeout(() => setCopiedToEF(false), 2000);
  };

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: T.radiusSm,
      padding: "12px 14px",
      marginBottom: 10,
      boxShadow: T.shadow,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{
          background: bg, color, border: `1px solid ${border}`,
          borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em",
        }}>{item.label}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {platform === "apollo" && (
            <>
              <button
                onClick={sendToEventFold}
                style={{
                  background: copiedToEF ? T.greenBg : T.accentBg,
                  border: `1px solid ${copiedToEF ? T.greenBorder : T.accentBorder}`,
                  color: copiedToEF ? T.green : T.accent,
                  borderRadius: T.radiusSm, padding: "3px 10px", fontSize: 11, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.03em",
                  transition: "all 0.15s",
                }}
              >
                {copiedToEF ? "✓ Copied" : "→ EventFold"}
              </button>
              <button
                onClick={searchLive}
                disabled={liveLoading}
                style={{
                  background: liveLoading ? T.bg : T.amberBg,
                  border: `1px solid ${T.amberBorder}`, color: T.amber,
                  borderRadius: T.radiusSm, padding: "3px 10px", fontSize: 11, fontWeight: 600,
                  cursor: liveLoading ? "not-allowed" : "pointer", fontFamily: "inherit",
                }}
              >
                {liveLoading ? "Searching..." : "Search Live"}
              </button>
            </>
          )}
          <CopyButton text={item.query} />
        </div>
      </div>
      <div style={{
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        color: T.text,
        background: T.bg,
        border: `1px solid ${T.border}`,
        padding: "8px 12px",
        borderRadius: 4,
        lineHeight: 1.6,
        wordBreak: "break-word",
      }}>{item.query}</div>
      {item.filters && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
          {Object.entries(item.filters).filter(([, v]) => v).map(([k, v], i, arr) => (
            <span key={k} style={{ fontSize: 11, color: T.textSub }}>
              <span style={{ color: T.textMuted, fontWeight: 500 }}>{k}:</span>{" "}
              <span>{v}</span>
              {i < arr.length - 1 && <span style={{ color: T.border, margin: "0 3px" }}>·</span>}
            </span>
          ))}
        </div>
      )}
      {liveError && (
        <div style={{ marginTop: 8, fontSize: 12, color: T.red, background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: 4, padding: "6px 10px" }}>{liveError}</div>
      )}
      {liveResults && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.amber, letterSpacing: "0.06em", marginBottom: 6 }}>
            LIVE RESULTS — {liveResults.total > 0 ? `${liveResults.total.toLocaleString()} companies` : `${liveResults.companies.length} returned`}
          </div>
          {liveResults.companies.length === 0 && (
            <div style={{ fontSize: 12, color: T.textMuted, padding: "8px 0" }}>No companies found for these filters.</div>
          )}
          {liveResults.companies.map((co, i) => (
            <div key={i} style={{
              background: T.bg, border: `1px solid ${T.border}`, borderRadius: T.radiusSm,
              padding: "10px 12px", marginBottom: 6,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{co.name}</div>
                  {co.website_url && (
                    <div style={{ fontSize: 11, color: T.accent, marginTop: 1 }}>{co.website_url}</div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  {co.num_employees != null && (
                    <span style={{ fontSize: 11, color: T.textMuted }}>{co.num_employees.toLocaleString()} employees</span>
                  )}
                  {co.industry && (
                    <span style={{ fontSize: 11, color: T.textMuted }}>{co.industry}</span>
                  )}
                </div>
              </div>
              {co.linkedin_url && (
                <div style={{ marginTop: 4, fontSize: 11, color: T.textSub }}>{co.linkedin_url}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProspectCrafter() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("anthropic_key") || import.meta.env.VITE_ANTHROPIC_KEY || "");
  const [apolloKey, setApolloKey] = useState(() => localStorage.getItem("apollo_key") || "");
  const [naicsCode, setNaicsCode] = useState("");
  const [naicsLabel, setNaicsLabel] = useState("");
  const [naicsSearch, setNaicsSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [sizes, setSizes] = useState([]);
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [phase, setPhase] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("apollo");
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("prospect_history") || "[]"); } catch { return []; }
  });

  const dropdownRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => { localStorage.setItem("anthropic_key", apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem("apollo_key", apolloKey); }, [apolloKey]);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleSize = (s) => setSizes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const selectNaics = (code, label) => {
    setNaicsCode(code);
    setNaicsLabel(label);
    setNaicsSearch("");
    setShowDropdown(false);
  };

  const clearNaics = () => {
    setNaicsCode("");
    setNaicsLabel("");
    setNaicsSearch("");
  };

  const filteredNaics = naicsSearch.trim()
    ? ALL_NAICS.filter(n =>
        n.label.toLowerCase().includes(naicsSearch.toLowerCase()) ||
        n.code.includes(naicsSearch) ||
        n.sector.toLowerCase().includes(naicsSearch.toLowerCase())
      )
    : null;

  const groupedFiltered = filteredNaics
    ? filteredNaics.reduce((acc, n) => {
        (acc[n.sector] = acc[n.sector] || []).push(n);
        return acc;
      }, {})
    : null;

  const getPhase = (text) => {
    if (text.includes('"enrichment_urls"'))         return "Finding enrichment sources...";
    if (text.includes('"red_flags"'))               return "Flagging disqualifiers...";
    if (text.includes('"qualification_checklist"')) return "Building qualification checklist...";
    if (text.includes('"linkedin"'))                return "Crafting LinkedIn searches...";
    if (text.includes('"google"'))                  return "Crafting Google searches...";
    if (text.includes('"apollo"'))                  return "Crafting Apollo searches...";
    if (text.includes('"searches"'))                return "Generating search queries...";
    if (text.includes('"signals"'))                 return "Identifying buying signals...";
    if (text.includes('"qualifying_criteria"'))     return "Building qualification criteria...";
    if (text.includes('"icp"'))                     return "Mapping company profile...";
    if (text.includes('"summary"'))                 return "Distilling ICP summary...";
    return "Analyzing target industry...";
  };

  const run = useCallback(async () => {
    if (!naicsCode) { setError("Select a NAICS code to target."); return; }
    if (!apiKey.trim()) { setError("Add your Anthropic API key above first."); return; }
    setLoading(true);
    setError(null);
    setResult(null);
    setStreamText("");
    setPhase("Researching live market data...");

    // Phase 1: Web search research (non-blocking — falls through on any error)
    let researchContext = "";
    try {
      const researchPrompt = `You are researching a B2B sales target vertical for Foxworks Studios, an AI engineering firm.

Research: ${naicsCode} — ${naicsLabel}

Use web search to find:
1. Companies in this vertical that raised Series A, B, or C funding in the last 18 months (company names, amounts, dates)
2. Companies in this vertical currently hiring machine learning engineers, AI engineers, or data scientists (job board evidence)
3. Notable technology shifts, compliance events, or market pressures in this vertical in the last 12 months
4. 3–5 named example companies that represent the ideal buyer profile

Return a JSON object:
{
  "recent_funding": [{ "company": string, "amount": string, "date": string, "stage": string }],
  "hiring_ai": [{ "company": string, "role": string, "evidence": string }],
  "market_pressures": ["string — specific, recent, named"],
  "example_companies": [{ "name": string, "why": string }]
}

Return ONLY valid JSON. No preamble, no markdown fences.`;

      const researchRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "web-search-2025-03-05",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 4000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: researchPrompt }],
        }),
      });

      if (researchRes.ok) {
        const researchData = await researchRes.json();
        const researchText = researchData.content
          ?.filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("") || "";
        if (researchText.trim()) {
          researchContext = researchText.replace(/```json|```/g, "").trim();
          setPhase("Market data gathered — generating intelligence...");
        }
      }
    } catch { /* research failed — proceed without grounding */ }

    // Phase 2: Generation
    const prompt = `Target industry: NAICS ${naicsCode} — ${naicsLabel}
${sizes.length ? `Company sizes: ${sizes.join(", ")} employees` : ""}
${context ? `Additional context: ${context}` : ""}${researchContext ? `

Current market research for this vertical:
${researchContext}

Use this research to ground your intel package in real companies and real trends. Name specific companies as examples where relevant. Reference actual market pressures you found.` : ""}

Build me a full prospecting intelligence package for this target.`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "interleaved-thinking-2025-05-14",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 16000,
          thinking: { type: "enabled", budget_tokens: 8000 },
          stream: true,
          system: ANTHROPIC_SYSTEM,
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || `API error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let inThinkingBlock = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") continue;
          try {
            const event = JSON.parse(raw);
            if (event.type === "content_block_start") {
              if (event.content_block?.type === "thinking") {
                inThinkingBlock = true;
                setPhase("Thinking deeply about this vertical...");
              } else if (event.content_block?.type === "text") {
                inThinkingBlock = false;
                setPhase("Analyzing target industry...");
              }
            }
            if (
              event.type === "content_block_delta" &&
              event.delta?.type === "text_delta" &&
              !inThinkingBlock
            ) {
              accumulated += event.delta.text;
              setStreamText(accumulated);
              setPhase(getPhase(accumulated));
              if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
            }
          } catch { /* partial SSE line, skip */ }
        }
      }

      const clean = accumulated.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setResult(parsed);
      setActiveTab("apollo");

      const entry = {
        id: Date.now(),
        naicsCode,
        naicsLabel,
        sizes,
        context,
        result: parsed,
        timestamp: Date.now(),
      };
      const newHistory = [entry, ...history].slice(0, 15);
      setHistory(newHistory);
      localStorage.setItem("prospect_history", JSON.stringify(newHistory));
    } catch (e) {
      setError(e.message || "Failed to generate — check your API key and try again.");
    } finally {
      setLoading(false);
      setStreamText("");
      setPhase("");
    }
  }, [naicsCode, naicsLabel, sizes, context, apiKey, history]);

  const loadFromHistory = (entry) => {
    setNaicsCode(entry.naicsCode);
    setNaicsLabel(entry.naicsLabel);
    setSizes(entry.sizes || []);
    setContext(entry.context || "");
    setResult(entry.result);
    setActiveTab("apollo");
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const tabStyle = (active, color, bg, border) => ({
    padding: "6px 14px",
    borderRadius: T.radiusSm,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    cursor: "pointer",
    border: `1px solid ${active ? border : T.border}`,
    transition: "all 0.15s",
    background: active ? bg : T.surface,
    color: active ? color : T.textSub,
    fontFamily: "inherit",
  });

  const inputBase = {
    width: "100%",
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: T.radiusSm,
    color: T.text,
    outline: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  };

  const label = {
    fontSize: 12,
    fontWeight: 600,
    color: T.textSub,
    display: "block",
    marginBottom: 6,
    letterSpacing: "0.02em",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: T.bg,
      fontFamily: "'DM Sans', 'Inter', 'Segoe UI', sans-serif",
      color: T.text,
      padding: "28px 24px 48px",
      maxWidth: 880,
      margin: "0 auto",
    }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 28,
        paddingBottom: 20,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <img
            src="/logo.png"
            alt="Foxworks"
            style={{ width: 40, height: 40, objectFit: "contain", filter: "invert(0)" }}
          />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: T.textMuted, textTransform: "uppercase", marginBottom: 2 }}>
              Foxworks Studios
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: "-0.02em", color: T.text, lineHeight: 1.1 }}>
              Prospect Intelligence
            </h1>
          </div>
        </div>

        {/* API Keys */}
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <label style={{ ...label, marginBottom: 4 }}>Anthropic Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              style={{
                ...inputBase,
                width: 220,
                border: `1px solid ${apiKey ? T.greenBorder : T.border}`,
                padding: "7px 12px",
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: apiKey ? T.green : T.text,
              }}
            />
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: T.accent, textDecoration: "none", opacity: 0.8 }}
            >
              Get Anthropic key →
            </a>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <label style={{ ...label, marginBottom: 4 }}>Apollo Key <span style={{ fontWeight: 400, color: T.textMuted }}>(for live search)</span></label>
            <input
              type="password"
              value={apolloKey}
              onChange={e => setApolloKey(e.target.value)}
              placeholder="Apollo API key..."
              style={{
                ...inputBase,
                width: 220,
                border: `1px solid ${apolloKey ? T.amberBorder : T.border}`,
                padding: "7px 12px",
                fontSize: 12,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                color: apolloKey ? T.amber : T.text,
              }}
            />
            <a
              href="https://app.apollo.io/#/settings/integrations/api"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: T.accent, textDecoration: "none", opacity: 0.8 }}
            >
              Get Apollo key →
            </a>
          </div>
        </div>
      </div>

      {/* ── Input Panel ── */}
      <div style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.radius,
        padding: "22px 24px",
        marginBottom: 20,
        boxShadow: T.shadow,
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 20px", color: T.text }}>Build Prospect Intel Package</h2>

        {/* NAICS Selector */}
        <div style={{ marginBottom: 18 }}>
          <label style={label}>Target Industry (NAICS)</label>

          {naicsCode ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                flex: 1,
                background: T.accentBg,
                border: `1px solid ${T.accentBorder}`,
                borderRadius: T.radiusSm,
                padding: "9px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: T.accent, fontWeight: 700 }}>{naicsCode}</span>
                <span style={{ fontSize: 13, color: T.text, fontWeight: 600 }}>{naicsLabel}</span>
              </div>
              <button
                onClick={clearNaics}
                style={{
                  background: T.surface, border: `1px solid ${T.border}`, color: T.textSub,
                  borderRadius: T.radiusSm, padding: "9px 14px", cursor: "pointer",
                  fontSize: 12, fontFamily: "inherit", fontWeight: 500,
                }}
              >
                ✕ Change
              </button>
            </div>
          ) : (
            <div ref={dropdownRef} style={{ position: "relative" }}>
              <input
                value={naicsSearch}
                onChange={e => { setNaicsSearch(e.target.value); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Search by industry, sector, or NAICS code..."
                style={{ ...inputBase, padding: "9px 14px", fontSize: 13 }}
              />
              {showDropdown && (
                <div style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.radius,
                  maxHeight: 360,
                  overflowY: "auto",
                  zIndex: 100,
                  boxShadow: T.shadowMd,
                }}>
                  {!naicsSearch.trim() && (
                    <>
                      <div style={{ padding: "10px 14px 4px", fontSize: 10, letterSpacing: "0.1em", color: T.accent, fontWeight: 700, textTransform: "uppercase" }}>
                        Suggested for AI / Software Sales
                      </div>
                      {SUGGESTED_NAICS.map(n => (
                        <div
                          key={n.code}
                          onMouseDown={() => selectNaics(n.code, n.label)}
                          style={{ padding: "9px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${T.bg}` }}
                          onMouseEnter={e => e.currentTarget.style.background = T.accentBg}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700, minWidth: 52 }}>{n.code}</span>
                          <span style={{ fontSize: 13, color: T.text }}>{n.label}</span>
                        </div>
                      ))}
                      <div style={{ padding: "10px 14px 4px", fontSize: 10, letterSpacing: "0.1em", color: T.textMuted, fontWeight: 700, textTransform: "uppercase", marginTop: 4, borderTop: `1px solid ${T.border}` }}>
                        All Industries — type to search
                      </div>
                    </>
                  )}
                  {!naicsSearch.trim() && ALL_NAICS.reduce((sectors, n) => {
                    if (!sectors.includes(n.sector)) sectors.push(n.sector);
                    return sectors;
                  }, []).map(sector => (
                    <div key={sector}>
                      <div style={{ padding: "6px 14px 3px", fontSize: 10, letterSpacing: "0.1em", color: T.textMuted, fontWeight: 700, textTransform: "uppercase" }}>{sector}</div>
                      {ALL_NAICS.filter(n => n.sector === sector).map(n => (
                        <div
                          key={n.code}
                          onMouseDown={() => selectNaics(n.code, n.label)}
                          style={{ padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${T.bg}` }}
                          onMouseEnter={e => e.currentTarget.style.background = T.bg}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: T.textMuted, minWidth: 52 }}>{n.code}</span>
                          <span style={{ fontSize: 13, color: T.textSub }}>{n.label}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  {naicsSearch.trim() && !filteredNaics?.length && (
                    <div style={{ padding: "16px 14px", fontSize: 13, color: T.textMuted }}>No results for &ldquo;{naicsSearch}&rdquo;</div>
                  )}
                  {naicsSearch.trim() && filteredNaics?.length > 0 && Object.entries(groupedFiltered).map(([sector, items]) => (
                    <div key={sector}>
                      <div style={{ padding: "6px 14px 3px", fontSize: 10, letterSpacing: "0.1em", color: T.textMuted, fontWeight: 700, textTransform: "uppercase" }}>{sector}</div>
                      {items.map(n => (
                        <div
                          key={n.code}
                          onMouseDown={() => selectNaics(n.code, n.label)}
                          style={{ padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${T.bg}` }}
                          onMouseEnter={e => e.currentTarget.style.background = T.bg}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: T.textMuted, minWidth: 52 }}>{n.code}</span>
                          <span style={{ fontSize: 13, color: T.textSub }}>{n.label}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Company Size */}
        <div style={{ marginBottom: 18 }}>
          <label style={label}>Company Size <span style={{ fontWeight: 400, color: T.textMuted }}>(employees, optional)</span></label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SIZES.map(s => (
              <button
                key={s}
                onClick={() => toggleSize(s)}
                style={{
                  padding: "5px 13px",
                  borderRadius: T.radiusSm,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  border: `1px solid ${sizes.includes(s) ? T.accentBorder : T.border}`,
                  background: sizes.includes(s) ? T.accentBg : T.surface,
                  color: sizes.includes(s) ? T.accent : T.textSub,
                  transition: "all 0.1s",
                  fontFamily: "inherit",
                }}
              >{s}</button>
            ))}
          </div>
        </div>

        {/* Additional Context */}
        <div style={{ marginBottom: 20 }}>
          <label style={label}>Additional Context <span style={{ fontWeight: 400, color: T.textMuted }}>(optional)</span></label>
          <input
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder={'e.g. "We sell custom AI agents, avg deal $15k, focus on ops-heavy companies"'}
            style={{ ...inputBase, padding: "9px 14px", fontSize: 13 }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={run}
            disabled={loading || !naicsCode}
            style={{
              background: loading || !naicsCode ? T.border : T.accent,
              color: loading || !naicsCode ? T.textMuted : "#fff",
              border: "none",
              borderRadius: T.radiusSm,
              padding: "10px 24px",
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.04em",
              cursor: loading || !naicsCode ? "not-allowed" : "pointer",
              transition: "background 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={e => { if (!loading && naicsCode) e.currentTarget.style.background = T.accentHover; }}
            onMouseLeave={e => { if (!loading && naicsCode) e.currentTarget.style.background = T.accent; }}
          >
            {loading ? "Analyzing..." : "Generate Intel Package →"}
          </button>
          {loading && (
            <span style={{ fontSize: 12, color: T.accent, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
              <span style={{ display: "inline-block", width: 12, height: 12, border: `2px solid ${T.accentBorder}`, borderTopColor: T.accent, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              <span style={{ animation: "pulse 1.6s ease infinite" }}>{phase}</span>
            </span>
          )}
        </div>

        {error && (
          <div style={{ marginTop: 12, background: T.redBg, border: `1px solid ${T.redBorder}`, borderRadius: T.radiusSm, padding: "9px 14px", fontSize: 13, color: T.red }}>
            {error}
          </div>
        )}
      </div>

      {/* ── Streaming Terminal ── */}
      {loading && streamText && (
        <div style={{ marginBottom: 20 }}>
          <div
            ref={streamRef}
            style={{
              background: "#0f172a",
              border: `1px solid #1e293b`,
              borderRadius: T.radius,
              padding: "14px 16px",
              maxHeight: 260,
              overflowY: "auto",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontSize: 11,
              lineHeight: 1.7,
              color: "#475569",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            <span style={{ color: "#334155" }}>{"// "}{naicsCode} — {naicsLabel}{"\n"}</span>
            <span style={{ color: "#64748b" }}>{streamText}</span>
            <span style={{ animation: "pulse 0.8s ease infinite", color: T.accent }}>▌</span>
          </div>
        </div>
      )}

      {/* ── History Log ── */}
      {history.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: T.textMuted, marginBottom: 8, textTransform: "uppercase" }}>Recent Runs</div>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, overflow: "hidden", boxShadow: T.shadow }}>
            {history.map((entry, i) => (
              <div
                key={entry.id}
                onClick={() => loadFromHistory(entry)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 16px",
                  cursor: "pointer",
                  borderBottom: i < history.length - 1 ? `1px solid ${T.bg}` : "none",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bg}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ fontFamily: "monospace", fontSize: 11, color: T.accent, fontWeight: 700, minWidth: 52 }}>{entry.naicsCode}</span>
                <span style={{ fontSize: 13, color: T.text, flex: 1 }}>{entry.naicsLabel}</span>
                {entry.sizes?.length > 0 && (
                  <span style={{ fontSize: 11, color: T.textMuted }}>{entry.sizes.join(", ")}</span>
                )}
                <span style={{ fontSize: 11, color: T.textMuted }}>{timeAgo(entry.timestamp)}</span>
                <span style={{ fontSize: 11, color: T.accent, opacity: 0.6 }}>Load →</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div style={{ animation: "fadeIn 0.3s ease" }}>
          <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>

          {/* Export Controls */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 12 }}>
            <button
              onClick={() => exportJSON(result, naicsCode, naicsLabel)}
              style={{
                background: T.surface,
                border: `1px solid ${T.border}`,
                color: T.textSub,
                borderRadius: T.radiusSm,
                padding: "6px 14px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.color = T.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.textSub; }}
            >
              ↓ JSON
            </button>
            <CopyButton text={buildMarkdown(result, naicsCode, naicsLabel)} label="⊞ Copy Markdown" successLabel="✓ Copied!" />
          </div>

          {/* ICP Summary Banner */}
          <div style={{
            background: T.accentBg,
            border: `1px solid ${T.accentBorder}`,
            borderRadius: T.radius,
            padding: "16px 20px",
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: T.accent, marginBottom: 6, textTransform: "uppercase" }}>ICP Summary</div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: T.text }}>{result.summary}</p>
          </div>

          {/* ICP Details */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 0 }}>
            <Section title="Company Types" accent={T.accent} accentBg={T.accentBg} accentBorder={T.accentBorder}>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {result.icp?.company_types?.map((t, i) => <Tag key={i}>{t}</Tag>)}
              </div>
            </Section>
            <Section title="Qualifying Criteria" accent={T.green} accentBg={T.greenBg} accentBorder={T.greenBorder}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {result.icp?.qualifying_criteria?.map((c, i) => (
                  <div key={i} style={{ fontSize: 13, color: T.text, display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ color: T.green, marginTop: 1, flexShrink: 0 }}>✓</span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <Section title="Buying Signals to Watch For" accent={T.amber}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {result.icp?.signals?.map((s, i) => (
                <div key={i} style={{ fontSize: 13, color: T.text, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ color: T.amber, marginTop: 2, flexShrink: 0 }}>◆</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Angles */}
          <Section title="Prospecting Angles" accent={T.violet}>
            {result.angles?.map((a, i) => (
              <div key={i} style={{
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusSm,
                padding: "12px 14px",
                marginBottom: 10,
                borderLeft: `3px solid ${T.violetBorder}`,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 5 }}>
                  <Tag color={T.violet} bg={T.violetBg} border={T.violetBorder}>Angle {i + 1}</Tag>
                  <span style={{ fontSize: 13, color: T.text, fontWeight: 700 }}>{a.name}</span>
                </div>
                <p style={{ margin: "0 0 8px", fontSize: 13, color: T.textSub }}>{a.hypothesis}</p>
                <div style={{
                  background: T.violetBg,
                  border: `1px solid ${T.violetBorder}`,
                  borderRadius: 4,
                  padding: "7px 12px",
                  fontSize: 13,
                  color: T.violet,
                  fontStyle: "italic",
                }}>&ldquo;{a.hook}&rdquo;</div>
              </div>
            ))}
          </Section>

          {/* Search Queries */}
          <Section title="Search Queries" accent={T.accent}>
            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <button onClick={() => setActiveTab("apollo")} style={tabStyle(activeTab === "apollo", T.amber, T.amberBg, T.amberBorder)}>Apollo</button>
              <button onClick={() => setActiveTab("google")} style={tabStyle(activeTab === "google", T.green, T.greenBg, T.greenBorder)}>Google</button>
              <button onClick={() => setActiveTab("linkedin")} style={tabStyle(activeTab === "linkedin", T.accent, T.accentBg, T.accentBorder)}>LinkedIn</button>
            </div>
            {activeTab === "apollo"   && result.searches?.apollo?.map((item, i)   => <SearchCard key={i} item={item} platform="apollo"   apolloKey={apolloKey} />)}
            {activeTab === "google"   && result.searches?.google?.map((item, i)   => <SearchCard key={i} item={item} platform="google"   apolloKey={apolloKey} />)}
            {activeTab === "linkedin" && result.searches?.linkedin?.map((item, i) => <SearchCard key={i} item={item} platform="linkedin" apolloKey={apolloKey} />)}
          </Section>

          {/* Qualification Checklist */}
          <Section title="Qualification Checklist" accent={T.pink}>
            {result.qualification_checklist?.map((item, i) => (
              <div key={i} style={{
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: T.radiusSm,
                padding: "10px 14px",
                marginBottom: 8,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}>
                <span style={{ color: T.pink, fontSize: 16, marginTop: 1, flexShrink: 0 }}>□</span>
                <div>
                  <div style={{ fontSize: 13, color: T.text, fontWeight: 600, marginBottom: 2 }}>{item.criterion}</div>
                  <div style={{ fontSize: 12, color: T.textSub }}>{item.how_to_verify}</div>
                </div>
              </div>
            ))}
          </Section>

          {/* Red Flags + Sources */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Section title="Disqualifiers / Red Flags" accent={T.red}>
              {result.red_flags?.map((f, i) => (
                <div key={i} style={{ fontSize: 13, color: T.text, display: "flex", gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
                  <span style={{ color: T.red, flexShrink: 0 }}>✕</span>
                  <span>{f}</span>
                </div>
              ))}
            </Section>
            <Section title="Where to Find Them" accent={T.green}>
              {result.enrichment_urls?.map((u, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                    <span style={{ fontSize: 13, color: T.green, fontWeight: 600 }}>{u.label}</span>
                    <CopyButton text={u.url} />
                  </div>
                  <div style={{ fontSize: 12, color: T.textSub }}>{u.why}</div>
                </div>
              ))}
            </Section>
          </div>
        </div>
      )}

      {/* ── Empty State ── */}
      {!result && !loading && (
        <div style={{
          textAlign: "center",
          padding: "60px 0",
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: T.radius,
          boxShadow: T.shadow,
        }}>
          <img src="/logo.png" alt="" style={{ width: 48, height: 48, objectFit: "contain", opacity: 0.12, marginBottom: 12 }} />
          <div style={{ fontSize: 14, color: T.textMuted }}>
            Select a NAICS code above to generate your prospect intel package.
          </div>
        </div>
      )}

    </div>
  );
}
