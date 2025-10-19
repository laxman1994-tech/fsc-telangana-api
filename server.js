import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());

// Determine the executable path based on the environment (Render's convention)
// Render sets this environment variable during the build process
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || 
                       '/usr/bin/google-chrome-stable' || 
                       '/usr/bin/chromium';

app.get("/fsc", async (req, res) => {
  const fscNo = req.query.no;
  if (!fscNo) {
    return res.status(400).json({ error: "FSC number missing" });
  }

  let browser;
  try {
    // Launch headless browser (Puppeteer)
    browser = await puppeteer.launch({
      headless: 'new', 
      executablePath: executablePath, // Crucial fix for "Could not find Chrome" error
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--single-process', 
        '--no-zygote'
      ],
      timeout: 30000 
    });
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setDefaultNavigationTimeout(45000); 

    await page.goto("https://epds.telangana.gov.in/FoodSecurityAct/", {
      waitUntil: "networkidle2",
    });

    await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find(link =>
        link.href.includes("frmRationCardDetails.aspx")
      );
      if (a) a.click();
    });

    await page.waitForNavigation({ waitUntil: "networkidle2" });
    await page.waitForSelector("input[type='text']", { timeout: 15000 });

    await page.type("input[type='text']", fscNo);
    await page.click("input[value='Search']");

    await page.waitForTimeout(5000); 

    // --- Data Extraction Logic ---
    const data = await page.evaluate(() => {
      const getText = (label) => {
        const cell = [...document.querySelectorAll('td')]
          .find(td => td.textContent.trim().includes(label) && td.parentElement.cells.length > 1);
        return cell && cell.nextElementSibling ? cell.nextElementSibling.textContent.trim() : "N/A";
      };

      const getMembers = () => {
          const members = [];
          const memberRows = Array.from(document.querySelectorAll('table:last-of-type tr'));
          
          memberRows.forEach(tr => {
              const cells = tr.querySelectorAll('td');
              if (cells.length > 1 && /^\s*\d+\s*$/.test(cells[0].textContent)) {
                  members.push({
                      sno: cells[0].textContent.trim(),
                      name: cells[1].textContent.trim(), 
                  }); 
              }
          });
          return members.length > 0 ? members : ["No members listed"];
      };

      const headOfFamily = getText("Head of the Family");
      const refNo = getText("FSC Reference No");
      
      if(headOfFamily === "N/A" && refNo === "N/A" && !document.body.textContent.includes('RATION CARD DETAILS')) {
          return { error: "No details found for this FSC number on the portal." };
      }

      return {
        newRationCardNo: getText("New Ration Card No"),
        fscReferenceNo: refNo,
        cardType: getText("Card Type"),
        applicationStatus: getText("Application Status"),
        headOfFamily: headOfFamily,
        district: getText("District"),
        gasConnection: getText("Gas Connection"),
        members: getMembers(), 
      };
    });
    // --- End Data Extraction Logic ---

    await browser.close();

    if (data.error) {
        return res.status(404).json(data); 
    }
    res.json(data);
    
  } catch (err) {
    console.error("Puppeteer Error:", err.message);
    res.status(500).json({ error: "Internal API Error during data fetching. Check logs for details." });
  } finally {
    if (browser) {
      await browser.close().catch(e => console.error("Error closing browser:", e));
    }
  }
});

app.listen(PORT, () => console.log(`✅ FSC API running on port ${PORT}`));
