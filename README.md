# ❄️🔥 Frostfall Frontier

A real, ad-free, paywall-free **snow-survival arcade + frontier town-building game** inspired by the gameplay those mobile ads promise — blending tactile 90s action-arcade fun with modern 2.5D visuals, Android support, and 25 progressive frontier towns.

## ✨ Gameplay Features

- **Hands-On Arcade Loop**: Floating virtual joystick (or WASD/Arrows) to chop snow pines, mine Coal/Iron/Frost Crystals, and hunt wildlife (Snow Rabbits, Arctic Deer, Boars, Grizzly Bears, Dire Wolves & Alpha Yetis with telegraphed dodgeable attacks!).
- **Physical Hauling & Pop-Up Building**: Resources physically stack on your character's back and arc into Furnaces, Build Pads, Workshops, and Trading Sleds.
- **Homestead Evolution & Zone Expansion**:
  - **Snow Camp → Timber Hut → Log Cabin → Stone House → Grand Mansion → Town Hall**
  - Every upgrade triggers a golden **Thaw Wave** that melts the frost barrier and unlocks new biomes, wildlife, resources, and businesses (**Timber Sawmill**, **Hunter's Lodge**, **Iron Smeltery**, **Fur Tannery**, **Hearth Tavern**, **Artisan Guild**, and **Explorer's Hall**).
- **Play Hands-On OR Manage Your Town Empire**:
  - Keep hunting bears and chopping timber yourself, OR hire autonomous **Lumberjacks, Hunters, Miners, Haulers, and Merchants** to bustle around your town.
  - Once you reach **Town Level**, assign named **Explorers** (Astrid, Bram, Kael, Freya) to run frontier expeditions for Gold, supplies, and Legacy Points.
- **25 Frontier Towns across 5 Biomes**:
  1. *Pinewood Thaw* (Towns 1–5)
  2. *Frozen Fjord* (Towns 6–10)
  3. *Ironback Peaks* (Towns 11–15)
  4. *Crystal Glacier* (Towns 16–20)
  5. *Aurora Citadel* (Towns 21–25)
  - Established towns keep sending passive **Frontier Tribute** while you expand onward, and you can jump back to any unlocked town anytime!

---

## 📱 Installing on Android

### Option 1: Download Pre-Built APK from GitHub Actions (Easiest!)
1. Open the **Actions** tab in this GitHub repository.
2. Click the latest green **Build Android APK & Web Bundle** workflow run.
3. Download the **`FrostfallFrontier-Android-APK`** artifact (`app-debug.apk`).
4. Transfer or download the `.apk` on your Android phone and tap to install (allow *Install unknown apps* when prompted).

### Option 2: Build Locally with Android Studio / Gradle
```bash
npm install
npm run build
npx cap sync android
npx cap open android
```
Then press **Run ▶** in Android Studio or run `./gradlew assembleDebug` inside `android/`.

---

## 💻 Running Locally in Browser

```bash
npm install
npm run dev
```
Open `http://localhost:5173` on desktop or mobile browser.
