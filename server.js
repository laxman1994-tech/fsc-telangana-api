import express from "express";
import puppeteer from "puppeteer";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());

// API Endpoint: /fsc?no=FSCXXXXXXXX
app.get("/fsc", async(req, res) => {
    const fscNo = req.query.no;
    if (!fscNo) return res.status(400).json({ error: "FSC number missing" });

    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();

        // Set realistic User-Agent to mimic a browser
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
            // Function to find the label and return the next cell's value
            const getText = (label) => {
                const cell = [...document.querySelectorAll('td')]
                    .find(td => td.textContent.trim().includes(label) && td.parentElement.cells.length > 1);

                return cell && cell.nextElementSibling ? cell.nextElementSibling.textContent.trim() : "N/A";
            };

            // Function to extract member list from the RATION CARD MEMBER DETAILS table
            const getMembers = () => {
                const members = [];
                // Target rows inside the member table (assuming it's after the main details table)
                const memberTable = [...document.querySelectorAll('table')].find(table =>
                    table.querySelector('th') && table.querySelector('th').textContent.includes('RATION CARD MEMBER DETAILS')
                );

                if (memberTable) {
                    const rows = memberTable.querySelectorAll('tr');
                    rows.forEach(tr => {
                        const cells = tr.querySelectorAll('td');
                        // Check if the first cell is a number (S No)
                        if (cells.length > 1 && /^\s*\d+\s*$/.test(cells[0].textContent)) {
                            members.push({
                                sno: cells[0].textContent.trim(),
                                name: cells[1].textContent.trim(),
                                // Add more fields if needed (e.g., age: cells[2].textContent.trim())
                            });
                        }
                    });
                }
                return members.length > 0 ? members : ["No members listed"];
            };

            const headOfFamily = getText("Head of the Family");
            const refNo = getText("FSC Reference No");

            if (headOfFamily === "N/A" && refNo === "N/A") {
                // If neither key field is found, assume no data
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
            return res.status(404).json(data);
        }
        res.json(data);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "API Failed to process EPDS request due to server or network error." });
    }
});

app.listen(PORT, () => console.log(`✅ FSC API running on port ${PORT}`));
