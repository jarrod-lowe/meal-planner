# Builds the `make seed-test` TransactWriteItems request: one sample holiday,
# the user as its member, four attendees, and a few one-off meals that use the
# sample catalogue's recipes (DESIGN §4). Run with
#   jq -n --arg table <table> --slurpfile user <admin-get-user JSON>
#      --rawfile random <480+ hex digits from /dev/urandom>
#      --slurpfile catalogue scripts/seed-catalogue.json -f scripts/seed-test.jq
# Dates and timestamps come from jq's clock, so it works the same on macOS
# and Linux.

# `n` as `width` lowercase hex digits, zero-padded.
def hex($width):
  [recurse(if . >= 16 then (. / 16 | floor) else empty end) | . % 16]
  | reverse
  | map("0123456789abcdef"[.:. + 1])
  | join("")
  | ("0" * ($width - length)) + .;

# A UUIDv7 from a Unix time in milliseconds and 32 random hex digits: version
# nibble 7 and variant bits 10.
def uuid7($millis; $rand):
  ($millis | hex(12)) as $t
  | ($rand[3:4] | explode[0] | (if . >= 97 then . - 87 else . - 48 end) % 4 + 8 | hex(1)) as $variant
  | "\($t[0:8])-\($t[8:12])-7\($rand[0:3])-\($variant)\($rand[4:7])-\($rand[7:19])";

def s: {S: .};

# Default mealtime times per slot (DESIGN §2.1).
def slotTime: {breakfast: "08:00", lunch: "12:30", dinner: "18:30"}[.];

# The sample meals: day of the holiday (0 is the start date), slot, a suffix
# for parallel meals, the catalogue recipe (null for none), and which
# attendees eat it. Dinner A and Dinner B on the second day show parallel
# meals; the third day's lunch has no recipe and no attendees, so it shows
# warnings.
def sampleMeals: [
  {day: 0, slot: "dinner", suffix: "", recipe: "Spaghetti bolognese", attendees: [0, 1, 2, 3]},
  {day: 1, slot: "breakfast", suffix: "", recipe: "Pancakes", attendees: [0, 1, 2, 3]},
  {day: 1, slot: "dinner", suffix: " A", recipe: "Chicken stir-fry", attendees: [0, 1, 2]},
  {day: 1, slot: "dinner", suffix: " B", recipe: null, attendees: [3]},
  {day: 2, slot: "lunch", suffix: "", recipe: null, attendees: []}
];

($random | gsub("[^0-9a-f]"; "")) as $hex
| ($user[0].UserAttributes | map(select(.Name == "sub"))[0].Value
    // error("admin-get-user returned no sub")) as $sub
| ($catalogue[0].recipes | map({key: .name, value: .id}) | from_entries) as $recipeIds
| (now * 1000 | floor) as $millis
| (sampleMeals | length) as $mealCount
# Each ID's timestamp is one millisecond after the last, so the IDs sort in
# the order below: holiday, attendees, meals, then mealtimes.
| (5 + 2 * $mealCount) as $idCount
| if ($hex | length) < $idCount * 32 then error("need \($idCount * 32) random hex digits") else . end
| [range($idCount) | uuid7($millis + .; $hex[. * 32:(. + 1) * 32])] as $ids
| ($ids[0]) as $holidayId
| ($ids[1:5]) as $attendeeIds
| ($millis / 1000 | floor) as $seconds
| ($seconds + 14 * 86400) as $startSeconds
| ($seconds | strftime("%Y-%m-%dT%H:%M:%S")
    + "." + ($millis % 1000 | tostring | ("00" + .)[-3:]) + "Z") as $updatedAt
| {version: {N: "1"}, updatedAt: ($updatedAt | s), updatedBy: ($sub | s)} as $versioned
| ("HOLIDAY#" + $holidayId) as $pk
| def put: {Put: {TableName: $table, Item: (. + $versioned), ConditionExpression: "attribute_not_exists(PK)"}};
[
  ({
    PK: ($pk | s), SK: ("META" | s), type: ("holiday" | s),
    id: ($holidayId | s),
    name: ("Sample holiday" | s),
    timeZone: ("Pacific/Auckland" | s),
    startDate: ($startSeconds | strftime("%Y-%m-%d") | s),
    endDate: ($seconds + 20 * 86400 | strftime("%Y-%m-%d") | s)
  } | put),
  ({
    PK: ($pk | s), SK: ("MEMBER#" + $sub | s), type: ("member" | s),
    GSI1PK: ("USER#" + $sub | s), GSI1SK: ($pk | s),
    userSub: ($sub | s)
  } | put),
  ([["Alex", "Sam", "Riley", "Jordan"], $attendeeIds] | transpose[] as [$name, $id]
    | {
        PK: ($pk | s), SK: ("ATTENDEE#" + $id | s), type: ("attendee" | s),
        id: ($id | s), name: ($name | s)
      } | put),
  (sampleMeals | to_entries[] | .key as $i | .value
    | ($ids[5 + $i]) as $mealId
    | ($startSeconds + .day * 86400) as $daySeconds
    # The app's date style, "1 Jan": the day without a leading zero.
    | ($daySeconds | (strftime("%d") | tonumber | tostring) + " " + strftime("%b")) as $date
    | {
        PK: ($pk | s), SK: ("MEAL#" + $mealId | s), type: ("meal" | s),
        id: ($mealId | s),
        name: ($date + " " + (.slot | .[0:1] | ascii_upcase) + .slot[1:] + .suffix | s),
        slot: (.slot | s),
        recipeId: (if .recipe == null then {NULL: true}
          else ($recipeIds[.recipe] // error("no catalogue recipe \(.recipe)")) | s end),
        mealtimes: {L: [{M: {
          id: ($ids[5 + $mealCount + $i] | s),
          at: (($daySeconds | strftime("%Y-%m-%d")) + "T" + (.slot | slotTime) | s),
          attendeeIds: {L: [.attendees[] | $attendeeIds[.] | s]}
        }}]}
      } | put)
]
