import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for cross-origin requests (Allows Hostinger to call Render API)
app.use(cors());

// API Endpoint: /fsc?no=FSCXXXXXXXX
app.get("/fsc", async (req, res) => {
  const fscNo = req.query.no;
  if (!fscNo) {
    return res.status(400).json({ error: "FSC number missing" });
  }

  let browser;
  try {
    // Launch headless browser (Puppeteer) with added arguments for stability on Render's environment
    browser = await puppeteer.launch({
      headless: 'new', // Use 'new' for latest headless mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',           // Added: Improves stability
        '--single-process',        // Added: Reduces memory usage and instability
        '--no-zygote'
      ],
      timeout: 30000 // Increase browser launch timeout
    });
    const page = await browser.newPage();
    
    // Set a realistic User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setDefaultNavigationTimeout(45000); // Set navigation timeout

    // 1. Go to the main page
    await page.goto("https://epds.telangana.gov.in/FoodSecurityAct/", {
      waitUntil: "networkidle2",
    });

    // 2. Click on Ration Card Search (frmRationCardDetails.aspx)
    // Use page.evaluate to click the link robustly
    await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find(link =>
        link.href.includes("frmRationCardDetails.aspx")
      );
      if (a) a.click();
    });

    // Wait for the navigation to the search page
    await page.waitForNavigation({ waitUntil: "networkidle2" });
    
    // Wait for the input field to be available
    await page.waitForSelector("input[type='text']", { timeout: 15000 });

    // 3. Type FSC number and click search
    await page.type("input[type='text']", fscNo);
    await page.click("input[value='Search']");

    // Wait for results to load (increased time for slow loading)
    await page.waitForTimeout(5000); 

    // 4. Extract key fields from the table structure
    const data = await page.evaluate(() => {
      // Function to find the label and return the next cell's value
      const getText = (label) => {
        const cell = [...document.querySelectorAll('td')]
          .find(td => td.textContent.trim().includes(label) && td.parentElement.cells.length > 1);
        
        return cell && cell.nextElementSibling ? cell.nextElementSibling.textContent.trim() : "N/A";
      };

      // Function to extract member list from the RATION CARD MEMBER DETAILS table
      const getMembers = () => {
          const members = [];
          // Assuming the member table is the last table on the page displaying data rows
          const memberRows = Array.from(document.querySelectorAll('table:last-of-type tr'));
          
          memberRows.forEach(tr => {
              const cells = tr.querySelectorAll('td');
              // Check if the first cell is a number (S No)
              if (cells.length > 1 && /^\s*\d+\s*$/.test(cells[0].textContent)) {
                  members.push({
                      sno: cells[0].textContent.trim(),
                      name: cells[1].textContent.trim(), // Assuming member name is the second cell
                  }); 
              }
          });
          return members.length > 0 ? members : ["No members listed"];
      };

      const headOfFamily = getText("Head of the Family");
      const refNo = getText("FSC Reference No");
      
      // Basic check to see if any data was returned
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

    await browser.close();

    if (data.error) {
        // Return 404 if data not found, which is better than 500
        return res.status(404).json(data); 
    }
    res.json(data);
    
  } catch (err) {
    console.error("Puppeteer Error:", err.message);
    // Send 500 error response if any exception occurs
    res.status(500).json({ error: "Internal API Error during data fetching. Check logs for details." });
  } finally {
    if (browser) {
      // Ensure the browser is closed even if an error occurred
      await browser.close().catch(e => console.error("Error closing browser:", e));
    }
  }
});

app.listen(PORT, () => console.log(`✅ FSC API running on port ${PORT}`));
