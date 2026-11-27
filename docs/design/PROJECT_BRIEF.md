# Project Brief

## Project Overview

This app will be a meal planner, suitable for a group to collaborate on meal planning and shopping for a holiday trip.

## Environment

It will deploy into AWS. `../dnd-planner` is an example of an AWS deployed project, with GitHub pipelines, security (etc.) steps, and deployment. We will deploy into the same account. We can borrow concepts from it that work for us, but the UI does not need to be modelled on the dnd-planner one.

Hostnames are under the parent domain `wildsea.lowe.kiwi`:

* Production: `meal-planner.wildsea.lowe.kiwi`
* Test: `meal-planner-test.wildsea.lowe.kiwi`

We will use Cognito for auth (no Google integration at this time). Users are created by an admin; there is no self-signup. It will be a web app.

## Use cases

Users need to be able to assign recipes to meals, develop shopping lists from that, and put things from our shopping lists into stock. Some complexities include:

* Shopping trips happen at specific times
* Not all shopping trips can obtain all items (e.g. a trip to a corner shop only, or a trip where frozen items cannot be included)
* Not every person attends every meal
* Some meals will need to be duplicated (e.g. Dinner A and Dinner B) to support times when not everyone can eat the same meal
* Some meals will be generic (e.g. Lunch from Jan 1 to Jan 5), and I don't want to plan each day of them separately
* I want the system to handle scaling recipes to the number of people eating then
* We need to be able to record what we have, and consume items out of stock (sometimes extra food gets used!)
* Last-minute changes happen: mealtimes may be added, removed or changed at any time, and everything must still come out correctly

The views must make the common tasks easy:

* Adding and editing a recipe
* Adding a meal and its mealtimes
* Assigning people and a recipe to a meal or mealtime
* Shopping (e.g. showing the list and adding items to stock)
* Adding arbitrary ingredients to stock, and removing them
* Identifying a shortfall (not enough stock for an upcoming mealtime)

## Concepts

These are the concepts, with standardised names. Use these names consistently in code and UI.

### Holiday

A _holiday_ is the top-level container: it holds the attendees, meals, mealtimes, shopping trips and stock for one trip. Recipes and ingredients are not part of a holiday; they are shared across all holidays, and every user can edit them. There is one version of each recipe: editing it affects every holiday that uses it, including past ones, which is acceptable because old holidays aren't important.

Any user can create a holiday, and then add other users to it. All members of a holiday have equal rights, including adding and removing users; the creator has no extra rights.

### User

A _user_ is a person who can log in (a Cognito account). Users are members of holidays.

### Attendee

An _attendee_ is a person who will be catered for at some point during a holiday. Attendees are separate from users: someone can be an attendee without a login (e.g. a child), and a user need not be an attendee.

### Ingredient

An _ingredient_ is a thing we eat or cook with, and the unit we count it in. It consists of:

* A name
* A unit
* A _shop section_ (e.g. Produce, Dairy, Frozen, Bakery, Pantry), so shoppers can pick up things from nearby aisles together

E.g. "Sugar, grams, Pantry".

There is no unit conversion. "Cereal, box" and "Cereal, kg" are two different ingredients; wherever ingredients are listed (especially shopping lists), ones with the same name should appear side by side so a human can deal with them.

Recipes, stock and shopping lists all refer to an ingredient plus a quantity, e.g. "Sugar, 500 grams".

### Recipe

A _recipe_ is a named recipe, including:

* A number of _servings_
* A list of ingredients, each with a quantity
* An optional free-text area (method, notes, source, etc.)

### Meal

A _meal_ is something we plan to eat, e.g. "Jan 1 Dinner", "Jan 2 Dinner", "Jan 1 - 5 Lunch", "Jan 1 - 10 Snacks".

A meal may have a recipe assigned to it. We must also support a meal _not_ having a recipe yet, while we are still deciding.

A meal has one or more mealtimes. A generic meal (e.g. "Jan 1 - 5 Lunch") has one mealtime per day, all sharing the meal's recipe, so the recipe is chosen once. A one-off meal (e.g. "Jan 1 Dinner") has a single mealtime; the UI should make that case feel like one thing rather than two.

Multi-course meals are rare. They can be handled as separate meals with mealtimes that follow each other.

### Mealtime

A _mealtime_ is one occurrence of a meal: the point in time when it is eaten, and who eats it.

A mealtime has some of the holiday's attendees assigned to it. The number of _servings_ for a mealtime is the count of its attendees. There are no servings overrides.

Attendees can differ between the mealtimes of one meal (e.g. someone is away for lunch on Jan 3).

Because not every person can eat the same food, there may be mealtimes at the same time ("Dinner A" and "Dinner B"). These are simply two meals, each with a mealtime at the same time. This likely doesn't need any specific support in code; the design just must not make it impossible.

### Stock

_Stock_ is the quantity of each ingredient we have at a given point in time. It changes through:

* **Manual additions**: arbitrary ingredients added to stock (e.g. things brought from home, or bought outside a planned shopping trip)
* **Manual removals**: arbitrary ingredients consumed out of stock (e.g. extra food got used)
* **Shopping trip purchases**: items recorded as obtained on a shopping trip
* **Mealtime consumption**: each mealtime automatically consumes its recipe's scaled ingredients at the time of the mealtime

Each of these happens at a point in time.

### Shopping Trip

A _shopping trip_ is a point in time when we are going to acquire more stock.

Each shopping trip lists the shop sections it can obtain from (by default, all of them). For example, a corner-shop trip might only cover Bakery and Dairy, and a trip with no freezer access covers everything except Frozen.

### Shopping List

A shopping trip's _shopping list_ is the ingredients to buy on that trip. Quantities are summed per ingredient across mealtimes, then reduced by the stock we will have. E.g. if one mealtime needs 3 cans of beans and another needs 2, and we will have 1 can in stock, the list wants 4 cans.

The list covers the mealtimes after the trip, up to the next shopping trip that can also obtain that ingredient. It is grouped by shop section, with same-named ingredients side by side.

While shopping, we must be able to:

* Mark an item on the list as obtained, adding it to stock (with the quantity editable, since we may buy more or less than listed)
* Leave an item not obtained
* Add arbitrary ingredients to stock that were not on the list

### Shortfall

A _shortfall_ happens when a mealtime is reached and stock can't satisfy its ingredients. Each shortfall is an alert, shown so we can fix it (e.g. by adding a shopping trip, or changing the meal).

## Cross-concepts

Here are some of the interconnections between concepts. This section doesn't repeat things from above; it just adds the non-obvious ones.

* **Time.** Mealtimes, shopping trips and manual stock changes have dates and times, local to the holiday. Ordering comes from these. Things at the same time are fine (e.g. Dinner A and Dinner B). The UI should make entering times easy, e.g. sensible defaults for breakfast, lunch and dinner.
* **Scaling.** A recipe used at a mealtime has its ingredients scaled by mealtime servings ÷ recipe servings (e.g. mealtime=8, recipe=4 → double all ingredients). Scaled quantities are shown as-is, with no rounding or special handling for staples; humans can work out what to do with "1.5 eggs".
* **Processing.** Stock, shopping lists and shortfalls are worked out by processing the whole holiday in time order: manual stock changes, shopping trip purchases and mealtime consumption. Any change (adding, removing or editing a mealtime, recipe, trip or stock change) means re-processing everything. A holiday is under ~30 days, so this is cheap.
* **Planned vs recorded purchases.** When looking ahead, upcoming shopping trips are assumed to obtain everything on their lists, so shortfalls only show where no trip can cover the need. Once a shopping trip has happened, only what was actually recorded as obtained counts.

## Non-functional requirements

* **Mobile.** Viewing a shopping list, adding items from it to stock, and adding arbitrary ingredients to stock must work well in a mobile web browser. Other views may be desktop-first.
* **Collaboration.** Several people may use a holiday at once. Refresh-to-see-changes is sufficient.

## UI Helpfulness

The UI should be helpful, aiding us in entering things. E.g., assigning a recipe to a meal should not require perfectly typing the recipe's name; and adding an ingredient to a recipe or to stock should make it easy to pick ingredients we have already added (keeping the same unit and shop section), and possibly even from a list of common ingredients we define in the repo.

## Non-goals

These are out of scope at this time:

* Google (or other social) login, and self-signup
* Unit conversion
* Servings overrides (e.g. half portions for children)
* Rounding scaled quantities, or treating staples specially
* Offline use
* Real-time updates between users
* Budgeting or cost splitting
* Nutrition tracking
* Expiry or perishability tracking
