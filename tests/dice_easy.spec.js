// Dice Job Application Automation Script
// This script automates job applications on Dice.com using Playwright and logs results in an Excel file.
// It includes enhanced error handling, logging, HTML report generation, and a robust batching system.
const { test, expect } = require("@playwright/test");
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const url = require("url"); // Node.js built-in module
const { Groq } = require("groq-sdk"); // Import Groq SDK
const pdfParse = require("pdf-parse"); // For reading PDF content
require("dotenv").config(); // Load environment variables

// --- Configuration ---
const SEARCH_ITEMS = [
  // Playwright-Specific Roles
  "Playwright",

  // General QA / Testing Roles
  "QA",
  "Quality",

  // Automation-Focused Roles
  "Automation",

  // SDET-Focused Titles
  "SDET",
  "Software Developer Engineer in Test",

  // Performance Testing Roles
  "Performance",
  "Load",
  "Stress",
  "JMeter",
];

const MAX_PAGES = 5; // The maximum number of pages to scrape for each search term.
const LOGIN_URL = "https://www.dice.com/dashboard/login";
const USERNAME = process.env.DICE_USERNAME; // Use env var
const PASSWORD = process.env.DICE_PASSWORD; // Use env var
const GROQ_API_KEY = process.env.GROQ_API_KEY; // Use env var

const MAX_CONCURRENT_TABS = 2;
const TAB_DELAY = 3000;
const PAGE_DELAY = 4000;

// --- Batching Configuration ---
const BATCH_SIZE = 5;

// Remove batch timeout limit to let batches run to completion
test.setTimeout(0); // 0 means no timeout

// --- LLM Configuration ---
// !!! IMPORTANT !!! Update this path to your CV PDF file
const CV_PATH = path.join(__dirname, "../CV/your_cv.pdf");
const GROQ_MODEL = "gemma2-9b-it"; // Or your preferred Groq model
const KEYWORD_EXTRACTION_PROMPT = `
Extract a list of highly relevant technical skills and job role keywords from the following CV text. Focus on action verbs, technologies, methodologies, and common industry terms. List each skill on a new line. If no relevant skills are found, respond with "No relevant skills found".

CV Text:
\`\`\`
{cvText}
\`\`\`

Keywords:
`;

const JOB_DESCRIPTION_MATCH_PROMPT = `
Analyze the following job description and the provided keywords extracted from a CV. Determine if there's a strong match between the job requirements and the CV's skills. Respond with "MATCH" if there's a good overlap, "PARTIAL_MATCH" if there's some overlap but not strong, or "NO_MATCH" if there's little to no overlap. Provide a brief explanation for your decision.

CV Keywords:
\`\`\`
{cvKeywords}
\`\`\`

Job Description:
\`\`\`
{jobDescription}
\`\`\`

Match:
`;

// --- Groq Client Initialization ---
let groqClient;
if (!GROQ_API_KEY) {
  console.error(
    "❌ GROQ_API_KEY not found in .env. LLM features will be disabled."
  );
} else {
  groqClient = new Groq({ apiKey: GROQ_API_KEY });
}

// --- Helper function to read PDF ---
async function readPdf(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ CV file not found at: ${filePath}`);
    return null;
  }
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error(`❌ Error reading PDF file ${filePath}: ${error.message}`);
    return null;
  }
}

// --- Function to get keywords from CV using Groq ---
async function getCVKeywords(cvText) {
  if (!groqClient || !cvText) {
    console.warn(
      "⚠️ Groq client not initialized or CV text is empty. Cannot extract keywords."
    );
    return [];
  }
  try {
    console.log("🧠 Sending CV to Groq for keyword extraction...");
    const chatCompletion = await groqClient.chat.completions.create({
      messages: [
        {
          role: "user",
          content: KEYWORD_EXTRACTION_PROMPT.replace("{cvText}", cvText),
        },
      ],
      model: GROQ_MODEL,
    });

    const responseContent = chatCompletion.choices[0]?.message?.content;
    if (
      !responseContent ||
      responseContent.toLowerCase() === "no relevant skills found"
    ) {
      console.log("ℹ️ Groq: No relevant skills found in CV.");
      return [];
    }

    const keywords = responseContent
      .split("\n")
      .map((kw) => kw.trim())
      .filter((kw) => kw.length > 1); // Filter out empty or very short strings

    console.log(`✅ Groq extracted ${keywords.length} keywords from CV.`);
    return keywords;
  } catch (error) {
    console.error(
      `❌ Groq API error during keyword extraction: ${error.message}`
    );
    return [];
  }
}

// --- Function to extract job description from a Playwright page ---
async function extractJobDescription(page) {
  try {
    console.log("🌐 Scraping job description text...");
    const descriptionSelectors = [
      '[data-cy="job-description"]', // Common Dice selector
      '[data-testid="job-description"]',
      ".job-description",
      'div[class*="job-description"]',
      'div[class*="JobDescription"]',
      'section[id*="description"]',
      'div[data-qa="job-description"]',
      "div.job-details-content", // General container that might hold description
      'div[class*="description"]',
    ];

    let jobDescriptionText = "";
    for (const selector of descriptionSelectors) {
      try {
        const elements = await page.$$(selector);
        for (const element of elements) {
          const text = await element.textContent();
          if (text && text.trim().length > 200) {
            // Arbitrary length to be considered a description
            jobDescriptionText += text.trim() + "\n\n";
          }
        }
      } catch (err) {
        // Selector might not exist, continue
        continue;
      }
    }

    // Basic cleaning: remove excessive whitespace
    jobDescriptionText = jobDescriptionText.replace(/\s+/g, " ").trim();

    if (jobDescriptionText.length < 200) {
      // If still too short, try a broader approach
      console.warn(
        "⚠️ Job description might be incomplete. Trying a broader scrape."
      );
      const allVisibleText = await page.evaluate(() => {
        const elements = document.querySelectorAll(
          "body *:not(script):not(style)"
        );
        let text = "";
        elements.forEach((el) => {
          if (el.offsetParent !== null) {
            // Check if element is visible
            text += el.textContent + " ";
          }
        });
        return text;
      });
      jobDescriptionText = allVisibleText.replace(/\s+/g, " ").trim();
      const lines = jobDescriptionText.split("\n");
      jobDescriptionText = lines
        .filter(
          (line) =>
            line.trim().length > 50 &&
            !line.trim().startsWith("Apply now") &&
            !line.trim().startsWith("Sign in")
        )
        .join("\n");
      jobDescriptionText = jobDescriptionText.replace(/\s+/g, " ").trim();

      if (jobDescriptionText.length < 200) {
        console.warn("⚠️ Could not extract a substantial job description.");
        return "";
      }
    }

    console.log(
      `✅ Extracted ${jobDescriptionText.length} characters of job description.`
    );
    return jobDescriptionText;
  } catch (error) {
    console.error(`❌ Error extracting job description: ${error.message}`);
    return "";
  }
}

// --- Function to compare job description with keywords using Groq ---
async function checkJobMatchWithLLM(cvKeywords, jobDescription) {
  if (!groqClient || cvKeywords.length === 0 || !jobDescription) {
    console.warn(
      "⚠️ Groq client not ready, no CV keywords, or no job description. Cannot perform LLM match."
    );
    return { match: "SKIPPED_LLM", reason: "Missing data or LLM client" };
  }

  try {
    const prompt =
      JOB_DESCRIPTION_MATCH_PROMPT.replace(
        "{cvKeywords}",
        cvKeywords.join(", ")
      ).replace("{jobDescription}", jobDescription) +
      "\n\nRespond with only one sentence.";
    const chatCompletion = await groqClient.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: GROQ_MODEL,
    });
    const responseContent = chatCompletion.choices[0]?.message?.content;
    if (responseContent && responseContent.toLowerCase().includes("match")) {
      return { match: "MATCH", reason: responseContent };
    } else if (
      responseContent &&
      responseContent.toLowerCase().includes("partial_match")
    ) {
      return { match: "PARTIAL_MATCH", reason: responseContent };
    } else {
      return { match: "NO_MATCH", reason: responseContent };
    }
  } catch (error) {
    console.error(`❌ Groq API error during job matching: ${error.message}`);
    return { match: "ERROR", reason: `Groq API error: ${error.message}` };
  }
}

// --- NEW: Function to download a page and its assets ---
async function downloadPage(page, targetUrl, outputDir) {
  console.log(`🚀 Attempting to download page: ${targetUrl}`);
  const baseUrl = new URL(targetUrl);
  // Create a base directory for the hostname, e.g., './downloaded_pages/www.dice.com'
  const outputBaseDir = path.join(outputDir, baseUrl.hostname);

  // Ensure the base directory exists
  if (!fs.existsSync(outputBaseDir)) {
    fs.mkdirSync(outputBaseDir, { recursive: true });
    console.log(`✅ Created directory: ${outputBaseDir}`);
  }

  try {
    // 1. Navigate and capture HTML
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 }); // Increased timeout for page loading
    const htmlContent = await page.content();

    // Determine the local path for the HTML file
    let pagePathname = url.parse(targetUrl).pathname;
    if (pagePathname === "/" || pagePathname === "")
      pagePathname = "/index.html";
    if (pagePathname.endsWith("/")) pagePathname += "index.html"; // Ensure files have names

    // Clean pathname to create valid file paths
    const cleanedPagePath = pagePathname.split("/").filter(Boolean).join("/");
    const outputPath = path.join(outputBaseDir, cleanedPagePath);

    // Ensure the directory for the HTML file exists
    const pageDir = path.dirname(outputPath);
    if (!fs.existsSync(pageDir)) {
      fs.mkdirSync(pageDir, { recursive: true });
    }

    // Save the main HTML file
    fs.writeFileSync(outputPath, htmlContent, "utf-8");
    console.log(`✅ Saved HTML: ${outputPath}`);

    // 2. Discover and fetch resources (basic: CSS, JS, Images)
    const resourceUrls = [];
    const downloadedResources = new Map(); // Map original URL to local relative path

    // Extract from <link>, <script>, <img>, <source> tags
    const selectors = [
      'link[rel="stylesheet"]',
      'link[rel="icon"]', // For favicon
      "script[src]",
      "img[src]",
      "source[src]",
    ];

    for (const selector of selectors) {
      const elements = await page.$$(selector);
      for (const element of elements) {
        const attr =
          selector.includes("link") || selector.includes("source")
            ? "href"
            : "src";
        const resourceUrl = await element.getAttribute(attr);

        if (resourceUrl) {
          try {
            const absoluteUrl = new URL(resourceUrl, targetUrl).href; // Resolve relative URLs
            if (!resourceUrls.find((item) => item.url === absoluteUrl)) {
              // Avoid duplicates
              resourceUrls.push({ url: absoluteUrl, element, attr });
            }
          } catch (e) {
            console.warn(
              `⚠️ Could not resolve URL for resource ${resourceUrl}: ${e.message}`
            );
          }
        }
      }
    }

    // --- TODO: More advanced extraction for CSS url() and inline styles would go here ---
    // This would involve fetching CSS, parsing it, and finding patterns.

    // Fetch and save each discovered resource
    for (const res of resourceUrls) {
      const resourceUrl = res.url;
      if (downloadedResources.has(resourceUrl)) continue; // Already downloaded

      try {
        console.log(`⬇️ Downloading resource: ${resourceUrl}`);
        const response = await page.request.get(resourceUrl, {
          timeout: 30000,
        });
        const buffer = await response.body();
        const contentType = response.headers()["content-type"] || "";

        // Determine local path and filename
        const parsedResourceUrl = url.parse(resourceUrl);
        const resourcePathParts = parsedResourceUrl.pathname
          .split("/")
          .filter(Boolean);
        let resourceFileName =
          resourcePathParts.pop() || `resource_${Date.now()}`; // Default name if path is empty
        let resourceDirParts = [...resourcePathParts]; // Copy parts for directory structure

        // Attempt to categorize and place into standard directories (css, js, images)
        if (contentType.includes("text/css")) {
          resourceDirParts.unshift("css");
          resourceFileName =
            resourcePathParts.pop() || `style_${Date.now()}.css`;
        } else if (contentType.includes("javascript")) {
          resourceDirParts.unshift("js");
          resourceFileName =
            resourcePathParts.pop() || `script_${Date.now()}.js`;
        } else if (contentType.includes("image")) {
          resourceDirParts.unshift("images");
          const ext = contentType.split("/")[1] || "bin";
          resourceFileName =
            resourcePathParts.pop() || `image_${Date.now()}.${ext}`;
        } else if (contentType.includes("font")) {
          resourceDirParts.unshift("fonts");
          resourceFileName =
            resourcePathParts.pop() ||
            `font_${Date.now()}.${contentType.split("/")[1]}`;
        } else {
          // For other types, keep original path or put in a generic 'assets' folder
          resourceDirParts.unshift("assets");
        }

        const finalResourceDir = path.join(
          outputBaseDir,
          resourceDirParts.join("/")
        );

        if (!fs.existsSync(finalResourceDir)) {
          fs.mkdirSync(finalResourceDir, { recursive: true });
        }

        const localResourcePath = path.join(finalResourceDir, resourceFileName);
        fs.writeFileSync(localResourcePath, buffer);
        console.log(`✅ Saved resource: ${localResourcePath}`);

        // Store mapping and prepare local path for rewriting (relative to the HTML file)
        const relativeLocalPath = path
          .relative(pageDir, localResourcePath)
          .replace(/\\/g, "/");
        downloadedResources.set(resourceUrl, relativeLocalPath);
      } catch (error) {
        console.error(
          `❌ Failed to download resource ${resourceUrl}: ${error.message}`
        );
      }
    }

    // 3. Rewrite HTML to point to local resources
    let rewrittenHtml = htmlContent;
    for (const [originalUrl, localPath] of downloadedResources.entries()) {
      // Escape special characters for regex, and ensure we match full URLs or paths
      const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match URLs within quotes, e.g., 'url' or "url"
      const regex = new RegExp(`(["'])${escapedUrl}\\1`, "g");
      rewrittenHtml = rewrittenHtml.replace(regex, `$1${localPath}$1`);
    }

    // Save the rewritten HTML
    fs.writeFileSync(outputPath, rewrittenHtml, "utf-8");
    console.log(`✅ Saved rewritten HTML: ${outputPath}`);

    return true;
  } catch (error) {
    console.error(`❌ Error downloading page ${targetUrl}: ${error.message}`);
    return false;
  }
}

// --- Class definition for JobApplicationLogger ---
class JobApplicationLogger {
  constructor() {
    this.workbook = new ExcelJS.Workbook();
    this.worksheet = null;
    this.serialNumber = 1;
    this.logsDir = path.join(__dirname, "..", "Logs");
    this.reportsDir = path.join(__dirname, "..", "Reports");
    this.filename = this.generateFilename();
    this.filepath = path.join(this.logsDir, this.filename);
    this.htmlReportPath = path.join(
      this.reportsDir,
      this.filename.replace(".xlsx", ".html")
    );
    this.startTime = new Date();
    this.jobData = [];
  }

  generateFilename() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;

    return `JobApp_${year}-${month}-${day}_${String(displayHours).padStart(
      2,
      "0"
    )}-${minutes}-${ampm}.xlsx`;
  }

  async initializeExcel() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
        console.log(`✅ Created Logs directory: ${this.logsDir}`);
      }

      if (!fs.existsSync(this.reportsDir)) {
        fs.mkdirSync(this.reportsDir, { recursive: true });
        console.log(`✅ Created Reports directory: ${this.reportsDir}`);
      }

      this.worksheet = this.workbook.addWorksheet("Job Applications");

      this.worksheet.columns = [
        { header: "Sr.No", key: "serialNo", width: 10 },
        { header: "Job Title", key: "jobTitle", width: 50 },
        { header: "Company Name", key: "companyName", width: 30 },
        { header: "Status", key: "status", width: 25 },
        { header: "Timestamp", key: "timestamp", width: 20 },
        { header: "LLM Match Score", key: "llmMatchScore", width: 15 },
        { header: "LLM Reason", key: "llmReason", width: 60 },
        { header: "Job Page URL", key: "jobPageUrl", width: 70 }, // Added for context
      ];

      const headerRow = this.worksheet.getRow(1);
      headerRow.font = { name: "Arial", size: 11, bold: true };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFB3D9FF" },
      };
      headerRow.alignment = { horizontal: "center", vertical: "middle" };

      console.log(`✅ Initialized Excel file: ${this.filename}`);
    } catch (error) {
      console.error(`❌ Error initializing Excel: ${error.message}`);
      throw error;
    }
  }

  async logJob(
    jobTitle,
    companyName,
    status,
    llmMatch = null,
    llmReason = "",
    jobPageUrl = ""
  ) {
    // Added jobPageUrl
    try {
      if (!this.worksheet) {
        console.error("❌ Excel worksheet not initialized");
        return;
      }

      const timestamp = new Date().toLocaleString();
      const jobEntry = {
        serialNo: this.serialNumber,
        jobTitle: jobTitle || "Unknown Job Title",
        companyName: companyName || "Unknown Company",
        status: status,
        timestamp: timestamp,
        category: this.categorizeStatus(status),
        llmMatchScore: llmMatch ? llmMatch.match : "N/A",
        llmReason: llmMatch ? llmMatch.reason : "",
        jobPageUrl: jobPageUrl || "N/A", // Log the URL
      };

      this.jobData.push(jobEntry);
      const row = this.worksheet.addRow(jobEntry);

      row.font = { name: "Arial", size: 10 };
      row.alignment = { horizontal: "left", vertical: "middle" };

      let fillColor = "FFFFFFFF"; // White default
      const statusLower = status.toLowerCase();
      if (statusLower.includes("success") || statusLower.includes("applied")) {
        fillColor = "FFD4EDDA"; // Light green
      } else if (
        statusLower.includes("failed") ||
        statusLower.includes("error")
      ) {
        fillColor = "FFF8D7DA"; // Light red
      } else if (statusLower.includes("already applied")) {
        fillColor = "FFFFEAA7"; // Light orange
      } else if (statusLower.includes("skipped")) {
        fillColor = "FFFFF3CD"; // Light yellow
      } else if (statusLower.includes("llm match")) {
        fillColor = "FFDAEDDB"; // Very light green for LLM match
      } else if (statusLower.includes("llm partial match")) {
        fillColor = "FFFFEEBB"; // Very light yellow for LLM partial match
      } else if (statusLower.includes("llm no_match")) {
        fillColor = "FFE6E6E6"; // Light grey for LLM no match
      }
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: fillColor },
      };

      this.serialNumber++;
      console.log(
        `📝 [${
          this.serialNumber - 1
        }] ${jobTitle} - ${companyName} - ${status} ${
          llmMatch ? `(LLM: ${llmMatch.match})` : ""
        }`
      );

      if (this.serialNumber % 5 === 0) {
        await this.saveExcel();
      }
    } catch (error) {
      console.error(`❌ Error logging job: ${error.message}`);
    }
  }

  categorizeStatus(status) {
    const statusLower = status.toLowerCase();
    if (statusLower.includes("success") || statusLower.includes("applied"))
      return "success";
    if (statusLower.includes("already applied")) return "already_applied";
    if (statusLower.includes("skipped")) return "skipped";
    if (statusLower.includes("failed") || statusLower.includes("error"))
      return "failed";
    if (statusLower.includes("llm match")) return "llm_match";
    if (statusLower.includes("llm partial_match")) return "llm_partial_match";
    if (statusLower.includes("llm no_match")) return "llm_no_match";
    return "unknown";
  }

  async saveExcel() {
    try {
      await this.workbook.xlsx.writeFile(this.filepath);
    } catch (error) {
      console.error(`❌ Error saving Excel file: ${error.message}`);
    }
  }

  getLogSummary() {
    return {
      filename: this.filename,
      totalEntries: this.serialNumber - 1,
      filepath: this.filepath,
      htmlReportPath: this.htmlReportPath,
    };
  }
}

// --- Helper functions (remain the same) ---
const matchesSearchCriteria = (jobTitle) => {
  if (!jobTitle) return { matches: false, matchingTerms: [] };
  const titleLower = jobTitle.toLowerCase();
  const matchingTerms = SEARCH_ITEMS.filter((searchItem) =>
    titleLower.includes(searchItem.toLowerCase())
  );
  return { matches: matchingTerms.length > 0, matchingTerms: matchingTerms };
};

const extractJobTitleFromDetailPage = async (page) => {
  try {
    const titleSelectors = [
      'h1[data-testid="job-title"]',
      'h1[data-cy="job-title"]',
      "h1.job-title",
      'h1[class*="job-title"]',
      'h1[class*="JobTitle"]',
      'h1[id*="job-title"]',
      "h1:first-of-type",
      "h1",
      ".job-header h1",
      ".job-details h1",
    ];
    for (const selector of titleSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          let title = await element.textContent();
          if (!title || !title.trim())
            title = await page.evaluate((el) => el.innerText, element);
          if (title && title.trim() && title.length > 3) {
            console.log(`✅ Job title found with selector: ${selector}`);
            return title.trim();
          }
        }
      } catch (err) {
        continue;
      }
    }
    try {
      const h1s = await page.$$("h1");
      for (const h1 of h1s) {
        let title = await h1.textContent();
        if (!title || !title.trim())
          title = await page.evaluate((el) => el.innerText, h1);
        if (title && title.trim() && title.length > 3) {
          console.log(`✅ Job title fallback found in <h1>`);
          return title.trim();
        }
      }
    } catch (err) {
      /* ignore */
    }
    console.warn("⚠️ Could not extract job title");
    return "Unknown Job Title";
  } catch (error) {
    console.error(`❌ Error extracting job title: ${error.message}`);
    return "Unknown Job Title";
  }
};

const extractCompanyName = async (page) => {
  try {
    const companySelectors = [
      '[data-testid="company-name"]',
      '[data-cy="company-name"]',
      ".company-name",
      '[class*="company-name"]',
      ".job-company",
      ".employer-name",
      'a[href*="/company/"]',
      'span[class*="company"]',
      ".company-info span",
    ];
    for (const selector of companySelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          let company = await element.textContent();
          if (!company || !company.trim())
            company = await page.evaluate((el) => el.innerText, element);
          if (company && company.trim() && company.length > 2) {
            console.log(`✅ Company name found with selector: ${selector}`);
            return company.trim();
          }
        }
      } catch (err) {
        continue;
      }
    }
    try {
      const companyLike = await page.$$(
        '[class*="company"], span[class*="company"], div[class*="company"]'
      );
      for (const el of companyLike) {
        let company = await el.textContent();
        if (!company || !company.trim())
          company = await page.evaluate((e) => e.innerText, el);
        if (company && company.trim() && company.length > 2) {
          console.log(`✅ Company name fallback found in company-like element`);
          return company.trim();
        }
      }
    } catch (err) {
      /* ignore */
    }
    console.warn("⚠️ Could not extract company name");
    return "Unknown Company";
  } catch (error) {
    console.error(`❌ Error extracting company name: ${error.message}`);
    return "Unknown Company";
  }
};

const safeGoto = async (page, url, retries = 2) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (page.isClosed()) {
        console.error(`❌ Page is closed, cannot navigate to ${url}`);
        return false;
      }
      console.log(`🔄 Loading: ${url} (Attempt ${attempt + 1})`);
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(2000);
      const title = await page.title();
      if (title && title.length > 0) {
        console.log(`✅ Successfully loaded: ${url}`);
        return true;
      }
    } catch (err) {
      console.error(
        `❌ Attempt ${attempt + 1} failed for ${url}: ${err.message}`
      );
      if (attempt < retries && !page.isClosed())
        await page.waitForTimeout(3000);
    }
  }
  return false;
};

const safeClick = async (page, selector, description = "element") => {
  try {
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.click(selector, { timeout: 10000 });
    console.log(`✅ Clicked: ${description}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to click ${description}: ${err.message}`);
    return false;
  }
};

// Process individual job
const processJob = async (context, jobCard, cardIndex, logger, cvKeywords) => {
  let newTab = null;
  let jobTitle = "Unknown Job Title";
  let companyName = "Unknown Company";
  let llmMatchResult = null;
  let currentJobPageUrl = null; // To store the URL of the job page

  try {
    if (context.pages().length === 0) {
      await logger.logJob(
        jobTitle,
        companyName,
        "Skipped - Context closed",
        null,
        "",
        currentJobPageUrl
      );
      return { success: false, reason: "Context closed", skipped: true };
    }

    const jobCardLink = jobCard.locator("a").first();
    const jobCardLinkCount = await jobCardLink.count();

    if (jobCardLinkCount === 0) {
      await logger.logJob(
        jobTitle,
        companyName,
        "Failed - No clickable link",
        null,
        "",
        currentJobPageUrl
      );
      return { success: false, reason: "No clickable link" };
    }

    console.log(`Opening job card ${cardIndex + 1}...`);

    const [newTabPromise] = await Promise.all([
      context.waitForEvent("page", { timeout: 15000 }),
      jobCardLink.click(),
    ]);
    newTab = await newTabPromise;

    if (!newTab || newTab.isClosed()) {
      await logger.logJob(
        jobTitle,
        companyName,
        "Failed - Tab opening error",
        null,
        "",
        currentJobPageUrl
      );
      return { success: false, reason: "Tab opening error" };
    }

    await newTab.waitForLoadState("domcontentloaded", { timeout: 15000 });
    await newTab.waitForTimeout(2000);
    currentJobPageUrl = newTab.url(); // Store the actual job page URL

    jobTitle = await extractJobTitleFromDetailPage(newTab);
    companyName = await extractCompanyName(newTab);

    console.log(
      `Job Details - Title: "${jobTitle}", Company: "${companyName}", URL: ${currentJobPageUrl}`
    );

    const jobDescription = await extractJobDescription(newTab);
    const isInitialMatch = matchesSearchCriteria(jobTitle);
    let llmMatchResult = null;
    if (!isInitialMatch.matches && jobDescription) {
      llmMatchResult = await checkJobMatchWithLLM(cvKeywords, jobDescription);
      console.log(
        `LLM Match Result for "${jobTitle}": ${llmMatchResult.match}`
      );

      if (
        llmMatchResult.match === "NO_MATCH" ||
        llmMatchResult.match === "ERROR"
      ) {
        const status = `Skipped (LLM ${llmMatchResult.match})`;
        await logger.logJob(
          jobTitle,
          companyName,
          status,
          llmMatchResult,
          "",
          currentJobPageUrl
        );
        return {
          success: false,
          reason: `LLM ${llmMatchResult.match}`,
          skipped: true,
          llmResult: llmMatchResult,
        };
      }
    } else {
      console.warn(
        `⚠️ No job description found for "${jobTitle}". Falling back to keyword search.`
      );
    }

    if (!jobDescription && !isInitialMatch.matches) {
      const reason = `Skipped - No LLM info & No initial match`;
      console.log(
        `❌ "${jobTitle}" doesn't match initial criteria or LLM info.`
      );
      await logger.logJob(
        jobTitle,
        companyName,
        reason,
        null,
        "",
        currentJobPageUrl
      );
      return { success: false, reason: reason, skipped: true };
    }

    if (
      (llmMatchResult &&
        (llmMatchResult.match === "MATCH" ||
          llmMatchResult.match === "PARTIAL_MATCH")) ||
      (!jobDescription && isInitialMatch.matches) ||
      isInitialMatch.matches
    ) {
      console.log(`Applying to "${jobTitle}"...`);
      const applicationResult = await applyToJob(newTab);

      if (applicationResult.success) {
        const status = applicationResult.alreadyApplied
          ? "Already Applied"
          : "Success - Applied";
        console.log(`✅ Application result for "${jobTitle}": ${status}`);
        await logger.logJob(
          jobTitle,
          companyName,
          status,
          llmMatchResult,
          "",
          currentJobPageUrl
        );
        return {
          success: true,
          alreadyApplied: applicationResult.alreadyApplied,
          llmResult: llmMatchResult,
        };
      } else {
        const status = `Failed - ${applicationResult.reason}`;
        console.log(
          `❌ Application failed for "${jobTitle}": ${applicationResult.reason}`
        );
        await logger.logJob(
          jobTitle,
          companyName,
          status,
          llmMatchResult,
          "",
          currentJobPageUrl
        );
        return {
          success: false,
          reason: applicationResult.reason,
          llmResult: llmMatchResult,
        };
      }
    } else {
      const status = `Skipped (No LLM Match or Fallback Failed)`;
      await logger.logJob(
        jobTitle,
        companyName,
        status,
        llmMatchResult,
        "",
        currentJobPageUrl
      );
      return {
        success: false,
        reason: status,
        skipped: true,
        llmResult: llmMatchResult,
      };
    }
  } catch (error) {
    const status = `Failed - ${error.message}`;
    console.error(
      `Error processing job card ${cardIndex + 1}: ${error.message}`
    );
    await logger.logJob(
      jobTitle,
      companyName,
      status,
      llmMatchResult,
      "",
      currentJobPageUrl
    );
    return { success: false, reason: error.message, llmResult: llmMatchResult };
  } finally {
    if (newTab && !newTab.isClosed()) {
      try {
        await newTab.close();
      } catch (closeErr) {
        console.error(`Failed to close tab: ${closeErr.message}`);
      }
    }
  }
};

// Process jobs with controlled concurrency
const processJobBatch = async (context, jobCards, logger, cvKeywords) => {
  const results = [];
  for (let i = 0; i < jobCards.length; i += MAX_CONCURRENT_TABS) {
    if (context.pages().length === 0) {
      console.warn("Context closed, stopping job batch processing.");
      break;
    }
    const batch = jobCards.slice(i, i + MAX_CONCURRENT_TABS);
    console.log(
      `🔄 Processing batch ${Math.floor(i / MAX_CONCURRENT_TABS) + 1} (${
        batch.length
      } jobs)`
    );

    const batchPromises = batch.map(async (jobCard, index) => {
      await new Promise((resolve) => setTimeout(resolve, index * TAB_DELAY));
      if (context.pages().length === 0)
        return { success: false, reason: "Context closed", skipped: true };
      return processJob(context, jobCard, i + index, logger, cvKeywords);
    });

    const batchResults = await Promise.allSettled(batchPromises);
    batchResults.forEach((result, index) => {
      if (result.status === "fulfilled") results.push(result.value);
      else {
        results.push({ success: false, reason: result.reason });
        console.error(`❌ Batch job ${i + index + 1} failed:`, result.reason);
      }
    });

    if (i + MAX_CONCURRENT_TABS < jobCards.length) {
      if (context.pages().length === 0) break;
      console.log(`⏳ Pausing ${PAGE_DELAY}ms before next batch...`);
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY));
    }
  }
  return results;
};

// Reusable login function
async function performLogin(page) {
  console.log("🔐 Starting login process...");
  if (await page.url().includes("/dashboard/overview")) {
    console.log("ℹ️ Already logged in.");
    return;
  }
  const loginSuccess = await safeGoto(page, LOGIN_URL);
  if (!loginSuccess) throw new Error("Failed to load login page");

  try {
    await page.waitForSelector('input[name="email"]', { timeout: 15000 });
    await page.fill('input[name="email"]', USERNAME);
    await safeClick(page, 'button[type="submit"]', "first submit button");
    await page.waitForSelector('input[name="password"]', { timeout: 15000 });
    await page.fill('input[name="password"]', PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }),
      safeClick(page, 'button[type="submit"]', "password submit button"),
    ]);
    console.log("✅ Login successful");
    await page.waitForTimeout(3000);
  } catch (loginError) {
    throw new Error(`Login failed: ${loginError.message}`);
  }
}

// Function to attempt applying to a job
async function applyToJob(page) {
  try {
    if (page.isClosed()) return { success: false, reason: "Page is closed" };
    console.log(`🎯 Attempting to apply to job: ${page.url()}`);
    await page.waitForTimeout(2000);

    const alreadyAppliedSelectors = [
      "text=You have already applied",
      "text=Application submitted",
      "text=Already applied",
      ".already-applied",
      "[data-testid='already-applied']",
      "text=Application received",
      "text=Applied",
    ];
    for (const selector of alreadyAppliedSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 1000 })) {
          console.log(`ℹ️ Already applied to this job (found: ${selector})`);
          return { success: true, alreadyApplied: true };
        }
      } catch (err) {
        /* continue */
      }
    }

    const applySelectors = [
      "#applyButton",
      "apply-button-wc",
      "button:has-text('Easy apply')",
      "button:has-text('Apply now')",
      "button:has-text('Apply')",
      "[data-testid='apply-button']",
      ".apply-button",
      "button[data-testid='easy-apply']",
      "input[value*='Apply']",
    ];
    let applyClicked = false;
    for (const selector of applySelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          await element.click();
          console.log(`✅ Clicked apply button: ${selector}`);
          applyClicked = true;
          await page.waitForTimeout(3000);
          break;
        }
      } catch (err) {
        /* continue */
      }
    }
    if (!applyClicked)
      return { success: false, reason: "No Apply button found" };

    const nextSelectors = [
      "button:has-text('Next')",
      "button:has-text('Continue')",
      "[data-testid='next-button']",
      ".next-button",
      "input[value*='Next']",
    ];
    for (const selector of nextSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          await element.click();
          console.log(`✅ Clicked next button: ${selector}`);
          await page.waitForTimeout(3000);
          break;
        }
      } catch (err) {
        /* continue */
      }
    }

    const submitSelectors = [
      "button:has-text('Submit')",
      "button:has-text('Submit Application')",
      "input[type='submit']",
      "[data-testid='submit-button']",
      ".submit-button",
      "button:has-text('Send Application')",
      "button:has-text('Apply Now')",
      "input[value*='Submit']",
    ];
    for (const selector of submitSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          await element.click();
          console.log(`✅ Clicked submit button: ${selector}`);
          await page.waitForTimeout(4000);
          break;
        }
      } catch (err) {
        /* continue */
      }
    }

    const confirmationSelectors = [
      ".post-apply-banner",
      "[data-testid='application-confirmation']",
      ".application-success",
      ".confirmation-message",
      "text=Application submitted",
      "text=Successfully applied",
      "text=Application received",
      "text=Thank you for applying",
      "text=Your application has been submitted",
      "text=Application sent",
    ];
    for (const selector of confirmationSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        console.log(`✅ Application confirmation found: ${selector}`);
        return { success: true, alreadyApplied: false };
      } catch (err) {
        /* continue */
      }
    }

    const currentUrl = page.url();
    if (
      currentUrl.includes("success") ||
      currentUrl.includes("applied") ||
      currentUrl.includes("confirmation") ||
      currentUrl.includes("thank-you")
    ) {
      console.log(`✅ Success indicated by URL: ${currentUrl}`);
      return { success: true, alreadyApplied: false };
    }
    console.log(
      `⚠️ Application attempt completed, but couldn't verify success`
    );
    return { success: true, alreadyApplied: false };
  } catch (err) {
    console.error(`❌ Error during job application: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

// --- SCRIPT EXECUTION STARTS HERE ---

const logger = new JobApplicationLogger();
const stats = {
  applied: 0,
  failed: 0,
  skipped: 0,
  alreadyApplied: 0,
  total: 0,
  llmMatch: 0,
  llmPartialMatch: 0,
  llmNoMatch: 0,
};
const DOWNLOADED_PAGES_DIR = "./downloaded_pages"; // Directory for saving downloaded pages

let cvKeywords = [];
test.beforeAll(async () => {
  await logger.initializeExcel();
  if (!GROQ_API_KEY) {
    console.error(
      "❌ GROQ_API_KEY is missing. LLM functionality will be disabled."
    );
  } else {
    console.log("Reading CV and extracting keywords...");
    const cvText = await readPdf(CV_PATH);
    if (cvText) {
      cvKeywords = await getCVKeywords(cvText);
      console.log(`CV Keywords extracted: ${cvKeywords.join(", ")}`);
    } else {
      console.warn(
        "⚠️ Could not obtain CV keywords. Falling back to traditional search."
      );
    }
  }
});

// --- DYNAMIC TEST GENERATION ---
for (let i = 0; i < SEARCH_ITEMS.length; i += BATCH_SIZE) {
  const batch = SEARCH_ITEMS.slice(i, i + BATCH_SIZE);

  test(`Batch ${i / BATCH_SIZE + 1}: Process [${batch.join(", ")}]`, async ({
    browser,
  }) => {
    let context;
    try {
      context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });
      const page = await context.newPage();

      await performLogin(page);

      for (const searchTerm of batch) {
        console.log(`\n🔍 Processing search term: "${searchTerm}"`);
        const encodedSearch = encodeURIComponent(searchTerm);

        for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
          if (page.isClosed()) {
            console.error("❌ Main page closed unexpectedly, skipping term.");
            break;
          }

          let url = `https://www.dice.com/jobs?filters.easyApply=true&filters.postedDate=ONE&q=${encodedSearch}`;
          if (pageNum > 1) url += `&page=${pageNum}`;

          console.log(`\n📄 Page ${pageNum} for "${searchTerm}"`);
          const pageLoaded = await safeGoto(page, url);
          if (!pageLoaded) {
            console.log(`⏭️ Skipping page ${pageNum} - failed to load`);
            continue;
          }

          try {
            await page.waitForSelector("[data-testid='job-search-serp-card']", {
              timeout: 15000,
            });
          } catch (err) {
            console.log(
              `✅ No more job cards found for "${searchTerm}" on page ${pageNum}. Moving to the next search term.`
            );
            break;
          }

          const jobCardLocator = page.locator(
            "[data-testid='job-search-serp-card']"
          );
          const jobCards = await jobCardLocator.all();
          console.log(`📋 Found ${jobCards.length} job cards`);

          if (jobCards.length > 0) {
            const results = await processJobBatch(
              context,
              jobCards,
              logger,
              cvKeywords
            );
            results.forEach((result) => {
              stats.total++;
              if (result.success) {
                if (result.alreadyApplied) stats.alreadyApplied++;
                else stats.applied++;
              } else if (result.skipped) {
                stats.skipped++;
              } else {
                stats.failed++;
              }
              if (result.llmResult) {
                if (result.llmResult.match === "MATCH") stats.llmMatch++;
                else if (result.llmResult.match === "PARTIAL_MATCH")
                  stats.llmPartialMatch++;
                else if (result.llmResult.match === "NO_MATCH")
                  stats.llmNoMatch++;
              }
            });
          } else {
            console.log(
              `✅ No results on this page. Moving to the next search term.`
            );
            break;
          }
        }
      }
    } finally {
      if (context) await context.close();
    }
  });
}

// --- FINAL REPORTING ---
test.afterAll(async () => {
  console.log("\n" + "=".repeat(70));
  console.log("✅ All batches completed.");

  await logger.saveExcel();

  const logSummary = logger.getLogSummary();

  console.log("\n" + "=".repeat(70));
  console.log("📊 FINAL SUMMARY");
  console.log("=".repeat(70));
  console.log(`📁 Excel Log: ${logSummary.filename}`);
  console.log(`📍 Location: ${logSummary.filepath}`);
  console.log(`📝 Total Jobs Processed: ${stats.total}`);
  console.log(`✅ Successfully Applied: ${stats.applied}`);
  console.log(`🔄 Already Applied: ${stats.alreadyApplied}`);
  console.log(`❌ Failed Applications: ${stats.failed}`);
  console.log(
    `⏭️ Skipped (No Match / LLM No Match): ${stats.skipped + stats.llmNoMatch}`
  );
  console.log(
    `🌟 LLM Matches (Good/Partial): ${stats.llmMatch + stats.llmPartialMatch}`
  );

  if (stats.total > 0) {
    console.log(
      `🎯 Success Rate (Manual Apply): ${(
        (stats.applied / stats.total) *
        100
      ).toFixed(1)}%`
    );
    const totalJobsWithLLM =
      stats.llmMatch + stats.llmPartialMatch + stats.llmNoMatch;
    if (totalJobsWithLLM > 0) {
      console.log(
        `🎯 LLM Match Confidence: ${(
          ((stats.llmMatch + stats.llmPartialMatch) / totalJobsWithLLM) *
          100
        ).toFixed(1)}%`
      );
    }
  }
  console.log("=".repeat(70));
});
