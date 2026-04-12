import { LEGAL_CONTACT } from "@/lib/legal/contact-details";
import {
  BILLING_VERSION,
  EFFECTIVE_DATE,
  PRIVACY_VERSION,
  RISK_VERSION,
  TERMS_VERSION,
} from "@/lib/legal/policy-versions";

export const TERMS_DOCUMENT = {
  label: "Legal",
  title: "Terms of Service",
  version: TERMS_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  summary:
    "These Terms govern access to the Narrative To Asset platform as a paid financial information and research software service. They are designed to keep the product positioned as information infrastructure, not execution, brokerage, or personal advice.",
  sections: [
    {
      title: "1. Service Description",
      paragraphs: [
        `${LEGAL_CONTACT.companyLegalName} operates ${LEGAL_CONTACT.serviceName} as a subscription software service for internet narrative tracking, market research, correlated asset discovery, and financial information workflows.`,
        "The service may surface public internet narratives, market-linked assets, memecoins, market data references, rankings, and analytics. The service is informational software only.",
      ],
    },
    {
      title: "2. Information Only",
      bullets: [
        "The service does not provide personal financial advice, investment advice, legal advice, or tax advice.",
        "The service does not recommend or solicit that you buy, sell, hold, or otherwise transact in any asset, security, token, derivative, or financial product.",
        "The service does not create a fiduciary relationship, advisory relationship, brokerage relationship, or managed account relationship between you and us.",
      ],
    },
    {
      title: "3. No Execution or Dealing",
      paragraphs: [
        "We do not execute trades, route orders, hold customer assets, custody funds, operate a trading venue, act as a broker or dealer, or manage accounts on your behalf.",
      ],
      bullets: [
        "No copy trading or mirrored trading is offered through the service.",
        "No discretion is exercised over your portfolio, capital, or transaction timing.",
        "Any links to third-party sites or market pages are informational references only.",
      ],
    },
    {
      title: "4. No Reliance and Independent Verification",
      paragraphs: [
        "You remain solely responsible for your own research, due diligence, trade decisions, and risk management. You must independently verify narratives, prices, links, token identities, liquidity, market conditions, and third-party information before acting.",
      ],
    },
    {
      title: "5. Account Eligibility and Security",
      bullets: [
        "You must provide accurate account information and keep your credentials secure.",
        "You must not share paid access beyond your authorized team or use automated collection against the service unless expressly permitted.",
        "You are responsible for all activity under your account.",
      ],
    },
    {
      title: "6. Acceptable Use",
      bullets: [
        "Do not reverse engineer, scrape at abusive rates, interfere with service security, or attempt unauthorized access.",
        "Do not use the service in violation of applicable financial, market, sanctions, privacy, or consumer laws.",
        "Do not republish third-party content or exported data in ways that infringe rights or breach source terms.",
      ],
    },
    {
      title: "7. Subscriptions, Billing, Renewal, Cancellation, and Refunds",
      paragraphs: [
        "Subscriptions renew automatically at the recurring price presented at checkout until cancelled. By subscribing, you authorize recurring charges using the payment method on file.",
        "Cancellation is self-serve through the Stripe customer portal or any in-app billing management route we provide. Unless otherwise stated, cancellation stops future renewal and access continues until the current billing period ends.",
        `Refunds are handled under the Refund Policy. Nothing in these Terms limits rights that cannot be excluded under applicable consumer law, including the Australian Consumer Law and other mandatory local protections.`,
      ],
    },
    {
      title: "8. Service Availability and Data Limitations",
      bullets: [
        "The service relies on third-party platforms, public sources, and automated processing.",
        "Data may be delayed, incomplete, inaccurate, manipulated, unavailable, rate limited, or misclassified.",
        "We do not guarantee uptime, uninterrupted access, completeness, accuracy, or fitness for any trading or investment purpose.",
      ],
    },
    {
      title: "9. Intellectual Property",
      paragraphs: [
        "We retain all rights in the software, interface design, rankings, original summaries, and service materials we own. Third-party content remains subject to the rights and terms of its original source.",
      ],
    },
    {
      title: "10. Suspension and Termination",
      bullets: [
        "We may suspend or terminate access for non-payment, security concerns, abuse, legal risk, sanctions risk, or breach of these Terms.",
        "You may stop using the service at any time and may cancel recurring billing through the available billing management route.",
      ],
    },
    {
      title: "11. Disclaimer of Warranties and Limitation of Liability",
      paragraphs: [
        "To the maximum extent permitted by law, the service is provided on an as is and as available basis without warranties of any kind.",
        "To the maximum extent permitted by law, we are not liable for trading losses, missed opportunities, data errors, outages, chargeback consequences, indirect damages, consequential damages, or loss of profits arising from use of the service.",
        "Nothing in these Terms excludes liability or statutory rights that cannot lawfully be excluded.",
      ],
    },
    {
      title: "12. Governing Law and Disputes",
      paragraphs: [
        "These Terms are governed by the laws of Western Australia and the laws of Australia applicable there. Courts with competent jurisdiction in Western Australia may hear disputes, subject to any non-excludable rights you have under local consumer law.",
      ],
    },
    {
      title: "13. Contact",
      paragraphs: [
        `${LEGAL_CONTACT.companyLegalName} | ${LEGAL_CONTACT.serviceAddress}`,
        `Support: ${LEGAL_CONTACT.supportEmail} | Billing: ${LEGAL_CONTACT.billingSupportEmail} | Legal: ${LEGAL_CONTACT.legalEmail}`,
      ],
    },
  ],
} as const;

export const PRIVACY_DOCUMENT = {
  label: "Legal",
  title: "Privacy Policy",
  version: PRIVACY_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  summary:
    "This Privacy Policy explains how we collect, use, disclose, store, and protect personal information for the Narrative To Asset service.",
  sections: [
    {
      title: "1. Controller and Contact",
      paragraphs: [
        `${LEGAL_CONTACT.companyLegalName} is the operator of ${LEGAL_CONTACT.serviceName}. Privacy requests can be sent to ${LEGAL_CONTACT.legalEmail} or ${LEGAL_CONTACT.supportEmail}.`,
      ],
    },
    {
      title: "2. Personal Information We Collect",
      bullets: [
        "Account data such as email address, authentication identifiers, profile details, and policy acceptance records.",
        "Billing data such as Stripe customer identifiers, subscription state, billing events, and transaction metadata returned to us by Stripe.",
        "Technical data such as IP address, device/browser details, logs, session cookies, and usage telemetry needed to secure and operate the service.",
        "Support and communications data when you contact us.",
      ],
    },
    {
      title: "3. Why We Use Personal Information",
      bullets: [
        "To create and secure accounts, authenticate users, and control paid access.",
        "To process subscriptions, reconcile Stripe events, handle billing support, and prevent abuse or fraud.",
        "To operate, maintain, monitor, and improve the service.",
        "To comply with legal obligations, enforce our Terms, and respond to complaints or lawful requests.",
      ],
    },
    {
      title: "4. Vendors and Processors",
      paragraphs: [
        "We use third-party infrastructure and processors to operate the service. Current processors include Stripe for billing and payments, Supabase for authentication and hosted database services, and our hosting and infrastructure providers that deliver the application and related logs.",
      ],
    },
    {
      title: "5. Cookies and Similar Technologies",
      paragraphs: [
        "We use cookies and similar storage mechanisms necessary for authentication, session continuity, and core service delivery. If we add non-essential analytics, advertising, or marketing cookies, we will provide the required notice and consent flow where applicable.",
      ],
    },
    {
      title: "6. Cross-Border Disclosure",
      paragraphs: [
        "Because we use cloud infrastructure and service providers, personal information may be stored or processed outside your country, including outside Australia. Where required, we take reasonable steps to work with providers that maintain appropriate safeguards.",
      ],
    },
    {
      title: "7. Retention",
      bullets: [
        "Account, subscription, and policy acceptance records are retained for as long as reasonably necessary to operate the service, evidence consent, handle disputes, and meet legal obligations.",
        "We may retain limited records after account closure where needed for security, fraud prevention, taxation, accounting, or legal compliance.",
      ],
    },
    {
      title: "8. Security",
      paragraphs: [
        "We use administrative, technical, and organizational measures intended to reduce unauthorized access, misuse, or disclosure. No internet service or storage system can be guaranteed fully secure.",
      ],
    },
    {
      title: "9. User Rights",
      paragraphs: [
        "Depending on your location, you may have rights to request access, correction, deletion, objection, portability, restriction, or withdrawal of consent where consent is the basis for processing. We will assess and respond in line with applicable law.",
      ],
    },
    {
      title: "10. Complaints",
      paragraphs: [
        `Please contact us first at ${LEGAL_CONTACT.legalEmail} so we can investigate and respond. If you are in Australia, you may also contact the OAIC. Users in other jurisdictions may contact their local regulator where available.`,
      ],
    },
  ],
} as const;

export const RISK_DISCLOSURE_DOCUMENT = {
  label: "Legal",
  title: "Risk Disclosure",
  version: RISK_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  summary:
    "The service is research software. It can influence decisions, but it does not remove risk, replace independent judgment, or guarantee outcomes.",
  sections: [
    {
      title: "1. Market Information Only",
      bullets: [
        "The platform provides information, rankings, and research workflows only.",
        "It does not provide personal financial advice and does not recommend that you enter, exit, or size any position.",
      ],
    },
    {
      title: "2. Crypto and Memecoin Risk",
      bullets: [
        "Crypto-assets and memecoins can be highly volatile and can lose most or all value quickly.",
        "Markets may be illiquid, thinly traded, manipulated, or driven by hype, rumor, or coordinated activity.",
        "Smart contract failures, bridge failures, exchange outages, wallet errors, custody failures, and counterparty failures can result in permanent loss.",
      ],
    },
    {
      title: "3. Data and Classification Risk",
      bullets: [
        "Narratives, links, symbols, pair mappings, prices, and availability can be delayed, incomplete, inaccurate, duplicated, or misclassified.",
        "Third-party platforms may change terms, APIs, rankings, or displayed data without notice.",
      ],
    },
    {
      title: "4. No Performance Guarantees",
      bullets: [
        "No guarantee is made that you will achieve profits, avoid losses, or outperform any market or benchmark.",
        "Past performance, prior narrative formation, historical correlations, and old case studies do not predict future results.",
      ],
    },
    {
      title: "5. User Responsibility",
      paragraphs: [
        "You are solely responsible for every decision you make, every order you place, every venue you use, and every risk control you apply or fail to apply. You should only use the service if you understand the relevant market risks and can afford losses.",
      ],
    },
  ],
} as const;

export const REFUND_POLICY_DOCUMENT = {
  label: "Legal",
  title: "Refund Policy",
  version: BILLING_VERSION,
  effectiveDate: EFFECTIVE_DATE,
  summary:
    "This Refund Policy explains how recurring billing, cancellation timing, continued access, and refund handling work for paid subscriptions.",
  sections: [
    {
      title: "1. Recurring Billing",
      paragraphs: [
        "Subscriptions renew automatically at the recurring interval disclosed at checkout until cancelled. Charges are processed by Stripe.",
      ],
    },
    {
      title: "2. Cancellation Timing",
      paragraphs: [
        "You can cancel through the Stripe customer portal or any in-app billing route we provide. Unless we say otherwise at the point of sale, cancellation prevents the next renewal and your paid access continues until the current billing period ends.",
      ],
    },
    {
      title: "3. Refunds",
      bullets: [
        "We do not generally provide pro-rata or partial refunds for unused time in an active billing period.",
        "We may review refund requests in cases such as duplicate charges, technical billing errors, or other exceptional circumstances.",
        "Nothing in this policy overrides non-excludable rights available under applicable consumer law.",
      ],
    },
    {
      title: "4. Immediate Access",
      paragraphs: [
        "Subscriptions are intended to provide immediate access to a digital research service. By starting a paid subscription, you request that access begin promptly after purchase.",
      ],
    },
    {
      title: "5. Support",
      paragraphs: [
        `Billing support requests can be sent to ${LEGAL_CONTACT.billingSupportEmail}.`,
      ],
    },
  ],
} as const;
