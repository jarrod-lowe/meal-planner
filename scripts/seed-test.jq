# Builds the `make seed-test` TransactWriteItems request: one sample holiday,
# the user as its member, and four attendees (DESIGN §4). Run with
#   jq -n --arg table <table> --slurpfile user <admin-get-user JSON>
#      --rawfile random <hex from /dev/urandom> -f scripts/seed-test.jq
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

($random | gsub("[^0-9a-f]"; "")) as $hex
| ($user[0].UserAttributes | map(select(.Name == "sub"))[0].Value
    // error("admin-get-user returned no sub")) as $sub
| (now * 1000 | floor) as $millis
# Each ID's timestamp is one millisecond after the last, so the IDs sort in
# the order below.
| [range(5) | uuid7($millis + .; $hex[. * 32:(. + 1) * 32])] as $ids
| ($ids[0]) as $holidayId
| ($millis / 1000 | floor) as $seconds
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
    startDate: ($seconds + 14 * 86400 | strftime("%Y-%m-%d") | s),
    endDate: ($seconds + 20 * 86400 | strftime("%Y-%m-%d") | s)
  } | put),
  ({
    PK: ($pk | s), SK: ("MEMBER#" + $sub | s), type: ("member" | s),
    GSI1PK: ("USER#" + $sub | s), GSI1SK: ($pk | s),
    userSub: ($sub | s)
  } | put),
  ([["Alex", "Sam", "Riley", "Jordan"], $ids[1:5]] | transpose[] as [$name, $id]
    | {
        PK: ($pk | s), SK: ("ATTENDEE#" + $id | s), type: ("attendee" | s),
        id: ($id | s), name: ($name | s)
      } | put)
]
