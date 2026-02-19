# gorgon-tools

A web-based level calculator for Project Gorgon character sheets.

## Features

- **Character Overview**: Display character name, race, and total level
- **Skills Breakdown**: View all skills with levels, bonus levels, and XP progress
- **NPC Relations**: Visualize favor levels with NPCs in a bar chart
- **Crafting Statistics**: Track recipes and crafting progress across skills
- **Search & Filter**: Search skills by name and filter by level
- **Multiple Input Methods**: Drag & drop JSON files, choose files via picker, or paste JSON directly

## Usage

1. Open `index.html` in your web browser
2. Load your Project Gorgon character sheet JSON by either:
   - Dragging and dropping the JSON file onto the drop zone
   - Clicking "Choose File" and selecting your JSON file
   - Pasting the JSON directly into the page (Ctrl+V / Cmd+V)

3. View your character stats, skills, NPC relations, and crafting progress
4. Use the search and filter controls to explore your skills

## Running Locally

You can serve the web app using any static file server. For example:

```bash
# Using Python 3
python3 -m http.server 8000

# Using Node.js http-server
npx http-server

# Using PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

## Character JSON Format

The app expects a Project Gorgon character sheet JSON with the following structure:

```json
{
  "Character": "CharacterName",
  "Race": "Human",
  "Timestamp": "2026-02-19",
  "Skills": {
    "SkillName": {
      "Level": 75,
      "BonusLevels": 5,
      "XpTowardNextLevel": 450000,
      "XpNeededForNextLevel": 500000
    }
  },
  "CurrentStats": {
    "MAX_HEALTH": 450,
    "MAX_ARMOR": 380,
    "MAX_POWER": 320
  },
  "Currencies": {
    "GOLD": 125000
  },
  "NPCs": {
    "NPCName": {
      "FavorLevel": "Friends"
    }
  },
  "RecipeCompletions": {
    "Cooking_RecipeName": 50
  }
}
```