# 🎯 Dice Job Auto-Apply Bot

[![Playwright](https://img.shields.io/badge/Playwright-45ba4b?style=for-the-badge&logo=Playwright&logoColor=white)](https://playwright.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=Node.js&logoColor=white)](https://nodejs.org/)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=JavaScript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Excel](https://img.shields.io/badge/Excel-217346?style=for-the-badge&logo=Microsoft-Excel&logoColor=white)](https://www.microsoft.com/en-us/microsoft-365/excel)

> **Automate your job applications on Dice.com with intelligent filtering and comprehensive reporting**

An intelligent automation bot that streamlines your job application process on Dice.com by automatically applying to relevant positions based on your specified criteria, with real-time logging and beautiful HTML dashboards.

---

## ✨ Features

### 🔍 **Smart Job Filtering**

- Searches for QA, Testing, Automation, and SDET roles
- Intelligent job title matching with customizable search terms
- Filters for "Easy Apply" jobs posted within the last day

### 🤖 **Automated Application Process**

- Handles complete application workflow
- Detects already applied positions
- Manages application confirmations
- Robust error handling and retry mechanisms

### 📊 **Comprehensive Reporting**

- **Excel Logs**: Detailed spreadsheet with color-coded status tracking
- **Interactive HTML Dashboard**: Beautiful web-based reports with charts
- **Real-time Statistics**: Live progress monitoring during execution

### 🛡️ **Safety & Reliability**

- Controlled concurrency to avoid overwhelming the site
- Intelligent delays and timeouts
- Context management and cleanup
- Detailed error logging and recovery

---

## 🚀 Quick Start

### Prerequisites

```bash
node --version  # v14+ required
npm --version   # Latest recommended
```

### Installation

```bash
# Clone the repository
git clone https://github.com/noelamarbabu/dice_apply_playwright.git
cd dice-job-automation

# Install dependencies
npm install playwright exceljs

# Install Playwright browsers
npx playwright install
```

### Configuration

1. Open `tests/applyJobs.spec.js`
2. Update your credentials:

```javascript
const USERNAME = "your_dice_username";
const PASSWORD = "your_dice_password";
```

### Run the Bot

```bash
npx playwright test tests/applyJobs.spec.js --headed
```

---

## 🎨 Dashboard Preview

The bot generates beautiful HTML reports with:

- 📈 **Interactive Pie Charts** - Visual breakdown of application results
- 🎯 **Summary Cards** - Quick statistics with hover animations
- 📋 **Detailed Tables** - Expandable job application logs
- 🎨 **Modern UI** - Clean, responsive design with smooth animations
- 🔍 **Smart Filtering** - Click cards to filter results by status

---

## ⚙️ Configuration Options

### Search Criteria

Customize the job search terms in the `SEARCH_ITEMS` array:

```javascript
const SEARCH_ITEMS = [
  "Software Tester",
  "Quality Assurance",
  "Test Automation",
  "SDET",
  "Performance Testing",
  // Add your preferred terms
];
```

### Performance Settings

```javascript
const MAX_PAGES = 3; // Pages to search per term
const MAX_CONCURRENT_TABS = 2; // Parallel job processing
const TAB_DELAY = 2000; // Delay between operations (ms)
const PAGE_DELAY = 3000; // Delay between pages (ms)
```

---

## 📁 Output Structure

```
project/
├── Logs/
│   └── JobApp_2024-12-14_02-30-PM.xlsx
├── Reports/
│   └── JobApp_2024-12-14_02-30-PM.html
└── tests/
    └── applyJobs.spec.js
```

### Excel Report Features

- ✅ **Color-coded status tracking**
- 📊 **Sortable columns**
- 🔢 **Auto-numbered entries**
- 🕒 **Timestamp logging**
- 📈 **Professional formatting**

### HTML Dashboard Features

- 🎨 **Modern responsive design**
- 📊 **Interactive Chart.js visualizations**
- 🔍 **Clickable filters and expandable details**
- 📱 **Mobile-friendly interface**
- ⚡ **Smooth animations and transitions**

---

## 🔧 Advanced Usage

### Custom Job Matching

Modify the `matchesSearchCriteria` function to implement custom filtering logic:

```javascript
const matchesSearchCriteria = (jobTitle) => {
  // Your custom matching logic here
  return { matches: true, matchingTerms: [] };
};
```

### Enhanced Company Filtering

Add company blacklist/whitelist functionality by modifying the `extractCompanyName` function.

### Custom Application Logic

Extend the `applyToJob` function to handle specific application forms or requirements.

---

## 📊 Statistics Tracking

The bot tracks comprehensive metrics:

- **✅ Successfully Applied** - New applications submitted
- **🔄 Already Applied** - Previously applied positions detected
- **❌ Failed Applications** - Technical errors or blocked applications
- **⏭️ Skipped Jobs** - Jobs not matching your criteria
- **🎯 Success Rate** - Percentage calculation of successful applications

---

## 🛠️ Troubleshooting

### Common Issues

**Login Problems**

- Verify your Dice.com credentials
- Check for CAPTCHA requirements
- Ensure account is not locked

**Slow Performance**

- Increase delay settings
- Reduce concurrent tabs
- Check internet connection

**Missing Job Details**

- Update selector patterns in extraction functions
- Check Dice.com UI changes
- Enable debug logging

### Debug Mode

Run with additional logging:

```bash
DEBUG=pw:* npx playwright test tests/applyJobs.spec.js
```

---

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Development Setup

```bash
# Install dev dependencies
npm install --save-dev @playwright/test

# Run tests
npm test

# Format code
npm run format
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

This tool is for educational and personal use only. Please:

- Respect Dice.com's terms of service
- Use reasonable delays to avoid overwhelming their servers
- Review and customize applications before submission
- Take responsibility for your job applications

---

## 🙏 Acknowledgments

- [Playwright](https://playwright.dev/) - Web automation framework
- [ExcelJS](https://github.com/exceljs/exceljs) - Excel file generation
- [Chart.js](https://www.chartjs.org/) - Beautiful charts for HTML reports

---

<div align="center">

**Made with ❤️ for job seekers everywhere**

**Powered by ADAA Corp.**

[⭐ Star this repository](https://github.com/yourusername/dice-job-automation) if you found it helpful!

</div>
# dice_apply_playwright
# dice_playwright
# Dice_auto
