import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000; // Render uses process.env.PORT

app.use(cors()); // Allow your Hostinger site to call this API

// API Endpoint: /fsc?no=FSCXXXXXXXX
app.get("/fsc", async (req, res) => {
  const fscNo = req.query.no;
  if (!fscNo) return res.status(400).json({ error: "FSC number missing" });

  try {
    // Launch headless browser (Puppeteer)
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    
    // Set a realistic User-Agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 1. Go to the main page
    await page.goto("https://epds.telangana.gov.in/FoodSecurityAct/", {
      waitUntil: "networkidle2",
    });

    // 2. Click on Ration Card Search (frmRationCardDetails.aspx)
    await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find(link =>
        link.href.includes("frmRationCardDetails")
      );
      if (a) a.click();
    });

    await page.waitForNavigation({ waitUntil: "networkidle2" });
    await page.waitForSelector("input[type='text']");

    // 3. Type FSC number and click search
    await page.type("input[type='text']", fscNo);
    await page.click("input[value='Search']");

    // Wait for results to load
    await page.waitForTimeout(4000); 

    // 4. Extract key fields from the table structure
    const data = await page.evaluate(() => {
      const getText = (label) => {
        // Find the <td> that contains the label
        const cell = [...document.querySelectorAll("td")].find(td =>
          td.textContent.trim().includes(label)
        );
        // Return the text content of the next <td> (the value)
        return cell ? cell.nextElementSibling?.textContent.trim() : "N/A";
      };
      
      const headOfFamily = getText("Head of the Family");
      const refNo = getText("FSC Reference No");
      
      if(headOfFamily === "N/A" && refNo === "N/A") {
          return { error: "No details found for this FSC number." };
      }

      return {
        headOfFamily: headOfFamily,
        district: getText("District"),
        mandal: getText("Mandal"),
        village: getText("Village"),
        cardType: getText("Card Type"),
        refNo: refNo,
        status: getText("Application Status"),
      };
    });

    await browser.close();

    if (data.error) {
        return res.status(404).json(data);
    }
    res.json(data);
    
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "API Failed to process EPDS request." });
  }
});

app.listen(PORT, () => console.log(`✅ FSC API running on port ${PORT}`));