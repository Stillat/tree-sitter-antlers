#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

enum TokenType {
  IF_OPEN_DELIMITER,
  UNLESS_OPEN_DELIMITER,
  ELSEIF_DELIMITER,
  ELSEUNLESS_DELIMITER,
  ELSE_DELIMITER,
  IF_CLOSE_DELIMITER,
  UNLESS_CLOSE_DELIMITER,
  TAG_PAIR_OPEN_DELIMITER,
  TAG_PAIR_CLOSE_DELIMITER,
  NOPARSE_OPEN_DELIMITER,
  NOPARSE_CONTENT,
  NOPARSE_CLOSE_DELIMITER,
  METHOD_RECEIVER,
  METHOD_ACCESSOR,
  DIRECTIVE_NAME_WITH_ARGUMENTS,
  BARE_CASCADE_NAME,
  TAG_RECOVERY_BOUNDARY,
  END_OF_FILE,
};

// Scanner state is embedded in syntax trees after every external token. Store
// full names rather than hashes so a collision can never pair unrelated tags.
// Names that cannot fit in Tree-sitter's serialization buffer simply fall
// back to the ordinary, non-structural antlers_tag rule.
#define MAX_PAIR_DEPTH 64
#define MAX_TAG_NAME_LENGTH 255

typedef struct {
  uint8_t depth;
  uint8_t name_lengths[MAX_PAIR_DEPTH];
  char names[MAX_PAIR_DEPTH][MAX_TAG_NAME_LENGTH + 1];
  uint16_t serialized_size;
} Scanner;

static void skip_whitespace(TSLexer *lexer) {
  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\r' || lexer->lookahead == '\n') {
    // We are looking ahead beyond mark_end, not skipping leading trivia.
    // Using `skip = true` here would move the external token's start past
    // the two braces and turn the visible delimiter into a zero-width node.
    lexer->advance(lexer, false);
  }
}

// End a malformed tag before a later Antlers region instead of allowing
// Tree-sitter's generic recovery to consume that region as part of the tag
// body. Requiring a line break and another `{{` keeps valid multiline tags
// and same-line nested tags available to their normal grammar rules. The
// token is zero-width: lookahead is reset to the mark at its starting point.
static bool scan_tag_recovery_boundary(TSLexer *lexer) {
  bool saw_line_break = false;
  lexer->mark_end(lexer);

  while (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\r' || lexer->lookahead == '\n') {
    if (lexer->lookahead == '\r' || lexer->lookahead == '\n') {
      saw_line_break = true;
    }
    lexer->advance(lexer, false);
  }

  if (!saw_line_break || lexer->lookahead != '{') {
    return false;
  }

  lexer->advance(lexer, false);
  return lexer->lookahead == '{';
}

static bool at_word_boundary(const TSLexer *lexer) {
  return lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
         lexer->lookahead == '\r' || lexer->lookahead == '\n' ||
         lexer->lookahead == '}';
}

static bool is_name_character(int32_t character) {
  return (character >= 'a' && character <= 'z') ||
         (character >= 'A' && character <= 'Z') ||
         (character >= '0' && character <= '9') || character == '_' ||
         character == '-' || character == ':' || character == '.' ||
         character == '/' || character == '>' || character == '$' ||
         character == '@' || character == '%';
}

static bool is_name_start(int32_t character) {
  return (character >= 'a' && character <= 'z') ||
         (character >= 'A' && character <= 'Z') || character == '_' ||
         character == '$' || character == '@' || character == '%';
}

static bool is_identifier_start(int32_t character) {
  return (character >= 'a' && character <= 'z') ||
         (character >= 'A' && character <= 'Z') || character == '_';
}

static bool is_identifier_character(int32_t character) {
  return is_identifier_start(character) ||
         (character >= '0' && character <= '9') || character == '-';
}

static bool scan_method_name(TSLexer *lexer) {
  if (!is_identifier_start(lexer->lookahead)) {
    return false;
  }

  bool ends_with_identifier = false;
  while (is_identifier_character(lexer->lookahead)) {
    ends_with_identifier = lexer->lookahead != '-';
    lexer->advance(lexer, false);
  }

  return ends_with_identifier;
}

// PATH is intentionally a single lexical token in the grammar so ordinary
// `collection:blog`, dotted variables, and slash paths stay compact. For a
// confirmed method call, look ahead to the accessor immediately before the
// method name and end this external receiver token there. Tree-sitter resets
// the lexer to mark_end, allowing the accessor and method to be parsed as
// first-class nodes without reserving compound-path separators globally.
static bool scan_method_receiver(TSLexer *lexer) {
  if (!is_name_start(lexer->lookahead) || lexer->lookahead == '%') {
    return false;
  }

  bool receiver_can_end = false;
  while (!lexer->eof(lexer)) {
    const int32_t character = lexer->lookahead;

    if (is_identifier_start(character) ||
        (character >= '0' && character <= '9')) {
      receiver_can_end = true;
      lexer->advance(lexer, false);
      continue;
    }

    if (character == '$' || character == '@') {
      receiver_can_end = false;
      lexer->advance(lexer, false);
      continue;
    }

    if (character == '/') {
      if (!receiver_can_end) {
        return false;
      }
      receiver_can_end = false;
      lexer->advance(lexer, false);
      continue;
    }

    if (character == '-') {
      if (!receiver_can_end) {
        return false;
      }

      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (lexer->lookahead != '>') {
        receiver_can_end = false;
        continue;
      }

      lexer->advance(lexer, false);
      if (!scan_method_name(lexer)) {
        return false;
      }
      if (lexer->lookahead == '(') {
        return true;
      }

      receiver_can_end = true;
      continue;
    }

    if (character == ':' || character == '.') {
      if (!receiver_can_end) {
        return false;
      }

      lexer->mark_end(lexer);
      lexer->advance(lexer, false);
      if (!scan_method_name(lexer)) {
        return false;
      }
      if (lexer->lookahead == '(') {
        return true;
      }

      receiver_can_end = true;
      continue;
    }

    return false;
  }

  return false;
}

static bool scan_method_accessor(TSLexer *lexer) {
  if (lexer->lookahead == ':' || lexer->lookahead == '.') {
    lexer->advance(lexer, false);
  } else if (lexer->lookahead == '-') {
    lexer->advance(lexer, false);
    if (lexer->lookahead != '>') {
      return false;
    }
    lexer->advance(lexer, false);
  } else {
    return false;
  }

  lexer->mark_end(lexer);
  return scan_method_name(lexer) && lexer->lookahead == '(';
}

static bool scan_directive_name(TSLexer *lexer, const bool *valid_symbols) {
  if (lexer->lookahead != '@') {
    return false;
  }

  lexer->advance(lexer, false);
  char name[16];
  size_t length = 0;
  while (is_identifier_start(lexer->lookahead)) {
    if (length + 1 >= sizeof(name)) {
      return false;
    }
    name[length++] = (char)lexer->lookahead;
    lexer->advance(lexer, false);
  }
  name[length] = '\0';

  const bool is_props = strcmp(name, "props") == 0;
  const bool is_aware = strcmp(name, "aware") == 0;
  const bool is_cascade = strcmp(name, "cascade") == 0;
  if (!is_props && !is_aware && !is_cascade) {
    return false;
  }

  lexer->mark_end(lexer);
  skip_whitespace(lexer);
  const bool has_arguments = lexer->lookahead == '(';

  if (has_arguments && valid_symbols[DIRECTIVE_NAME_WITH_ARGUMENTS]) {
    lexer->result_symbol = DIRECTIVE_NAME_WITH_ARGUMENTS;
    return true;
  }

  if (!has_arguments && is_cascade && valid_symbols[BARE_CASCADE_NAME]) {
    lexer->result_symbol = BARE_CASCADE_NAME;
    return true;
  }

  return false;
}

static bool scan_tag_name(TSLexer *lexer, char *buffer, uint8_t *length) {
  size_t scanned = 0;

  if (!is_name_start(lexer->lookahead)) {
    return false;
  }

  while (true) {
    while (is_name_character(lexer->lookahead)) {
      if (scanned >= MAX_TAG_NAME_LENGTH) {
        return false;
      }

      buffer[scanned++] = (char)lexer->lookahead;
      lexer->advance(lexer, false);
    }

    if (lexer->lookahead != '{') {
      break;
    }

    // Dynamic compound names interpolate a no-whitespace path only after a
    // normal path separator, as in `collection:{thing}`. Include the braces
    // and value in serialized pair names so `{thing}` can never pair with
    // `{other}` merely because their static prefixes match.
    if (scanned == 0 || buffer[scanned - 1] != ':') {
      break;
    }

    if (scanned >= MAX_TAG_NAME_LENGTH) {
      return false;
    }
    buffer[scanned++] = '{';
    lexer->advance(lexer, false);

    if (!is_name_start(lexer->lookahead) || lexer->lookahead == '%') {
      return false;
    }

    const size_t value_start = scanned;
    while (is_name_character(lexer->lookahead)) {
      if (scanned >= MAX_TAG_NAME_LENGTH) {
        return false;
      }

      buffer[scanned++] = (char)lexer->lookahead;
      lexer->advance(lexer, false);
    }

    if (scanned == value_start || lexer->lookahead != '}' ||
        !((buffer[scanned - 1] >= 'a' && buffer[scanned - 1] <= 'z') ||
          (buffer[scanned - 1] >= 'A' && buffer[scanned - 1] <= 'Z') ||
          (buffer[scanned - 1] >= '0' && buffer[scanned - 1] <= '9') ||
          buffer[scanned - 1] == '_')) {
      return false;
    }

    if (scanned >= MAX_TAG_NAME_LENGTH) {
      return false;
    }
    buffer[scanned++] = '}';
    lexer->advance(lexer, false);

    if (is_name_character(lexer->lookahead) && lexer->lookahead != ':') {
      return false;
    }
  }

  // `-` is also an operator. Excluding a trailing arrow keeps the scanner in
  // agreement with the grammar's PATH token for expressions like `foo ->`.
  if (scanned == 0 || buffer[scanned - 1] == '>' ||
      (scanned >= 2 && buffer[scanned - 2] == '-' &&
       buffer[scanned - 1] == '>')) {
    return false;
  }

  buffer[scanned] = '\0';
  *length = (uint8_t)scanned;
  return true;
}

static bool scan_to_tag_end(TSLexer *lexer, bool *self_closing) {
  int32_t quote = 0;
  bool escaped = false;
  int32_t previous = 0;

  *self_closing = false;
  while (!lexer->eof(lexer)) {
    const int32_t character = lexer->lookahead;
    lexer->advance(lexer, false);

    if (quote != 0) {
      if (escaped) {
        escaped = false;
      } else if (character == '\\') {
        escaped = true;
      } else if (character == quote) {
        quote = 0;
      }
      previous = character;
      continue;
    }

    if (character == '\'' || character == '"') {
      quote = character;
      previous = character;
      continue;
    }

    // An unquoted new Antlers opener means the current region never closed.
    // Do not borrow the later region's `}}`, which would make an incomplete
    // tag swallow otherwise valid syntax during editing.
    if (character == '{' && lexer->lookahead == '{') {
      return false;
    }

    if (character == '}' && lexer->lookahead == '}') {
      lexer->advance(lexer, false);
      *self_closing = previous == '/';
      return true;
    }

    previous = character;
  }

  return false;
}

static bool scan_closing_tag_end(TSLexer *lexer) {
  skip_whitespace(lexer);
  if (lexer->lookahead != '}') {
    return false;
  }

  lexer->advance(lexer, false);
  if (lexer->lookahead != '}') {
    return false;
  }

  lexer->advance(lexer, false);
  return true;
}

static void scan_to_special_end(TSLexer *lexer, int32_t marker) {
  while (!lexer->eof(lexer)) {
    const int32_t character = lexer->lookahead;
    lexer->advance(lexer, false);
    if (character != marker || lexer->lookahead != '}') {
      continue;
    }

    lexer->advance(lexer, false);
    if (lexer->lookahead == '}') {
      lexer->advance(lexer, false);
      return;
    }
  }
}

// The scanner must not claim an opening delimiter unless that tag can really
// become a pair. Otherwise its external token would win over the literal `{{`
// used by ordinary tags and force error recovery. Look ahead using Antlers'
// tag boundaries, count nested pairs with the same name, and leave mark_end at
// the original delimiter so none of the lookahead becomes part of the token.
static bool has_matching_close_ahead(TSLexer *lexer, const char *name,
                                     uint8_t name_length) {
  bool self_closing = false;
  if (!scan_to_tag_end(lexer, &self_closing) || self_closing) {
    return false;
  }

  unsigned same_name_depth = 1;
  int32_t previous = 0;

  while (!lexer->eof(lexer)) {
    const int32_t character = lexer->lookahead;
    lexer->advance(lexer, false);
    if (character != '{' || lexer->lookahead != '{') {
      previous = character;
      continue;
    }

    const bool escaped_antlers = previous == '@';
    lexer->advance(lexer, false);

    if (escaped_antlers) {
      if (!scan_to_tag_end(lexer, &self_closing)) {
        return false;
      }
      previous = 0;
      continue;
    }

    if (lexer->lookahead == '#' || lexer->lookahead == '?' ||
        lexer->lookahead == '$') {
      const int32_t marker = lexer->lookahead;
      lexer->advance(lexer, false);
      scan_to_special_end(lexer, marker);
      previous = 0;
      continue;
    }

    skip_whitespace(lexer);
    bool closing = false;
    if (lexer->lookahead == '/') {
      closing = true;
      lexer->advance(lexer, false);
      skip_whitespace(lexer);
    }

    char candidate[MAX_TAG_NAME_LENGTH + 1];
    uint8_t candidate_length = 0;
    const bool has_name = scan_tag_name(lexer, candidate, &candidate_length);
    const bool has_end = scan_to_tag_end(lexer, &self_closing);
    if (!has_end) {
      return false;
    }

    if (!has_name || candidate_length != name_length ||
        memcmp(candidate, name, name_length) != 0) {
      previous = 0;
      continue;
    }

    if (closing) {
      same_name_depth -= 1;
      if (same_name_depth == 0) {
        return true;
      }
    } else if (!self_closing) {
      same_name_depth += 1;
    }

    previous = 0;
  }

  return false;
}

static bool is_condition_name(const char *name) {
  return strcmp(name, "if") == 0 || strcmp(name, "unless") == 0 ||
         strcmp(name, "elseif") == 0 || strcmp(name, "elseunless") == 0 ||
         strcmp(name, "else") == 0 || strcmp(name, "endif") == 0 ||
         strcmp(name, "endunless") == 0;
}

static bool scan_noparse_close_candidate(TSLexer *lexer,
                                         bool mark_open_delimiter) {
  if (lexer->lookahead != '{') {
    return false;
  }

  lexer->advance(lexer, false);
  if (lexer->lookahead != '{') {
    return false;
  }

  lexer->advance(lexer, false);
  if (mark_open_delimiter) {
    lexer->mark_end(lexer);
  }
  skip_whitespace(lexer);

  if (lexer->lookahead != '/') {
    return false;
  }
  lexer->advance(lexer, false);
  skip_whitespace(lexer);

  char name[MAX_TAG_NAME_LENGTH + 1];
  uint8_t name_length = 0;
  if (!scan_tag_name(lexer, name, &name_length) ||
      strcmp(name, "noparse") != 0) {
    return false;
  }

  skip_whitespace(lexer);
  if (lexer->lookahead != '}') {
    return false;
  }
  lexer->advance(lexer, false);
  if (lexer->lookahead != '}') {
    return false;
  }
  lexer->advance(lexer, false);
  return true;
}

static bool can_push_name(const Scanner *scanner, uint8_t length) {
  return scanner->depth < MAX_PAIR_DEPTH &&
         scanner->serialized_size + 1u + length <=
             TREE_SITTER_SERIALIZATION_BUFFER_SIZE;
}

static void push_name(Scanner *scanner, const char *name, uint8_t length) {
  scanner->name_lengths[scanner->depth] = length;
  memcpy(scanner->names[scanner->depth], name, length + 1u);
  scanner->depth += 1;
  scanner->serialized_size += (uint16_t)(1u + length);
}

static bool top_name_matches(const Scanner *scanner, const char *name,
                             uint8_t length) {
  if (scanner->depth == 0) {
    return false;
  }

  const uint8_t index = scanner->depth - 1;
  return scanner->name_lengths[index] == length &&
         memcmp(scanner->names[index], name, length) == 0;
}

static void pop_name(Scanner *scanner) {
  if (scanner->depth == 0) {
    return;
  }

  scanner->depth -= 1;
  scanner->serialized_size -=
      (uint16_t)(1u + scanner->name_lengths[scanner->depth]);
  scanner->name_lengths[scanner->depth] = 0;
  scanner->names[scanner->depth][0] = '\0';
}

static bool scan_noparse_region_token(Scanner *scanner, TSLexer *lexer,
                                      const bool *valid_symbols) {
  bool has_content = false;

  while (!lexer->eof(lexer)) {
    if (lexer->lookahead == '{') {
      lexer->mark_end(lexer);
      if (scan_noparse_close_candidate(lexer, !has_content)) {
        if (has_content && valid_symbols[NOPARSE_CONTENT]) {
          lexer->result_symbol = NOPARSE_CONTENT;
          return true;
        }

        if (!has_content && valid_symbols[NOPARSE_CLOSE_DELIMITER]) {
          pop_name(scanner);
          lexer->result_symbol = NOPARSE_CLOSE_DELIMITER;
          return true;
        }

        return false;
      }

      has_content = true;
      lexer->mark_end(lexer);
      continue;
    }

    lexer->advance(lexer, false);
    has_content = true;
    lexer->mark_end(lexer);
  }

  if (has_content && valid_symbols[NOPARSE_CONTENT]) {
    lexer->result_symbol = NOPARSE_CONTENT;
    return true;
  }

  return false;
}

static bool emit_if_valid(TSLexer *lexer, const bool *valid_symbols,
                          enum TokenType symbol) {
  if (!valid_symbols[symbol]) {
    return false;
  }

  lexer->result_symbol = symbol;
  return true;
}

void *tree_sitter_antlers_external_scanner_create(void) {
  Scanner *scanner = calloc(1, sizeof(Scanner));
  if (scanner != NULL) {
    scanner->serialized_size = 1;
  }
  return scanner;
}

void tree_sitter_antlers_external_scanner_destroy(void *payload) {
  free(payload);
}

unsigned tree_sitter_antlers_external_scanner_serialize(void *payload,
                                                         char *buffer) {
  Scanner *scanner = (Scanner *)payload;
  if (scanner == NULL) {
    return 0;
  }

  unsigned offset = 0;
  buffer[offset++] = (char)scanner->depth;
  for (uint8_t index = 0; index < scanner->depth; index++) {
    const uint8_t length = scanner->name_lengths[index];
    buffer[offset++] = (char)length;
    memcpy(&buffer[offset], scanner->names[index], length);
    offset += length;
  }

  return offset;
}

void tree_sitter_antlers_external_scanner_deserialize(void *payload,
                                                       const char *buffer,
                                                       unsigned length) {
  Scanner *scanner = (Scanner *)payload;
  if (scanner == NULL) {
    return;
  }

  memset(scanner, 0, sizeof(Scanner));
  scanner->serialized_size = 1;
  if (length == 0) {
    return;
  }

  unsigned offset = 0;
  const uint8_t depth = (uint8_t)buffer[offset++];
  for (uint8_t index = 0; index < depth && index < MAX_PAIR_DEPTH; index++) {
    if (offset >= length) {
      break;
    }

    const uint8_t name_length = (uint8_t)buffer[offset++];
    if (name_length == 0 || offset + name_length > length) {
      break;
    }

    memcpy(scanner->names[index], &buffer[offset], name_length);
    scanner->names[index][name_length] = '\0';
    scanner->name_lengths[index] = name_length;
    scanner->depth += 1;
    scanner->serialized_size += (uint16_t)(1u + name_length);
    offset += name_length;
  }
}

bool tree_sitter_antlers_external_scanner_scan(void *payload, TSLexer *lexer,
                                               const bool *valid_symbols) {
  Scanner *scanner = (Scanner *)payload;

  if (valid_symbols[END_OF_FILE] && lexer->eof(lexer)) {
    lexer->result_symbol = END_OF_FILE;
    return true;
  }

  if (valid_symbols[TAG_RECOVERY_BOUNDARY] &&
      (lexer->lookahead == ' ' || lexer->lookahead == '\t' ||
       lexer->lookahead == '\r' || lexer->lookahead == '\n')) {
    if (scan_tag_recovery_boundary(lexer)) {
      lexer->result_symbol = TAG_RECOVERY_BOUNDARY;
      return true;
    }
    return false;
  }

  if (scanner != NULL && top_name_matches(scanner, "noparse", 7) &&
      (valid_symbols[NOPARSE_CONTENT] ||
       valid_symbols[NOPARSE_CLOSE_DELIMITER])) {
    return scan_noparse_region_token(scanner, lexer, valid_symbols);
  }

  if (lexer->lookahead != '{') {
    if (lexer->lookahead == '@' &&
        scan_directive_name(lexer, valid_symbols)) {
      return true;
    }
    if (valid_symbols[METHOD_ACCESSOR] && scan_method_accessor(lexer)) {
      lexer->result_symbol = METHOD_ACCESSOR;
      return true;
    }
    if (valid_symbols[METHOD_RECEIVER] && scan_method_receiver(lexer)) {
      lexer->result_symbol = METHOD_RECEIVER;
      return true;
    }
    return false;
  }

  lexer->advance(lexer, false);
  if (lexer->lookahead != '{') {
    return false;
  }

  lexer->advance(lexer, false);
  lexer->mark_end(lexer);
  skip_whitespace(lexer);

  bool closing = false;
  if (lexer->lookahead == '/') {
    closing = true;
    lexer->advance(lexer, false);
    skip_whitespace(lexer);
  }

  char name[MAX_TAG_NAME_LENGTH + 1];
  uint8_t name_length = 0;
  if (!scan_tag_name(lexer, name, &name_length)) {
    return false;
  }

  if (closing && at_word_boundary(lexer)) {
    if (strcmp(name, "if") == 0) {
      return emit_if_valid(lexer, valid_symbols, IF_CLOSE_DELIMITER);
    }

    if (strcmp(name, "unless") == 0) {
      return emit_if_valid(lexer, valid_symbols, UNLESS_CLOSE_DELIMITER);
    }
  }

  if (!closing && at_word_boundary(lexer)) {
    if (strcmp(name, "if") == 0) {
      return emit_if_valid(lexer, valid_symbols, IF_OPEN_DELIMITER);
    }

    if (strcmp(name, "unless") == 0) {
      return emit_if_valid(lexer, valid_symbols, UNLESS_OPEN_DELIMITER);
    }

    if (strcmp(name, "elseif") == 0) {
      return emit_if_valid(lexer, valid_symbols, ELSEIF_DELIMITER);
    }

    if (strcmp(name, "elseunless") == 0) {
      return emit_if_valid(lexer, valid_symbols, ELSEUNLESS_DELIMITER);
    }

    if (strcmp(name, "else") == 0) {
      return emit_if_valid(lexer, valid_symbols, ELSE_DELIMITER);
    }

    if (strcmp(name, "endif") == 0) {
      return emit_if_valid(lexer, valid_symbols, IF_CLOSE_DELIMITER);
    }

    if (strcmp(name, "endunless") == 0) {
      return emit_if_valid(lexer, valid_symbols, UNLESS_CLOSE_DELIMITER);
    }
  }

  if (is_condition_name(name) || scanner == NULL) {
    return false;
  }

  if (closing) {
    if (strcmp(name, "noparse") == 0 &&
        valid_symbols[NOPARSE_CLOSE_DELIMITER] &&
        top_name_matches(scanner, name, name_length) &&
        scan_closing_tag_end(lexer)) {
      pop_name(scanner);
      lexer->result_symbol = NOPARSE_CLOSE_DELIMITER;
      return true;
    }

    if (valid_symbols[TAG_PAIR_CLOSE_DELIMITER] &&
        top_name_matches(scanner, name, name_length) &&
        scan_closing_tag_end(lexer)) {
      pop_name(scanner);
      lexer->result_symbol = TAG_PAIR_CLOSE_DELIMITER;
      return true;
    }
    return false;
  }

  if (strcmp(name, "noparse") == 0 &&
      valid_symbols[NOPARSE_OPEN_DELIMITER] &&
      can_push_name(scanner, name_length)) {
    bool self_closing = false;
    if (scan_to_tag_end(lexer, &self_closing) && !self_closing) {
      push_name(scanner, name, name_length);
      lexer->result_symbol = NOPARSE_OPEN_DELIMITER;
      return true;
    }
  }

  if (valid_symbols[TAG_PAIR_OPEN_DELIMITER] &&
      can_push_name(scanner, name_length) &&
      has_matching_close_ahead(lexer, name, name_length)) {
    push_name(scanner, name, name_length);
    lexer->result_symbol = TAG_PAIR_OPEN_DELIMITER;
    return true;
  }

  return false;
}
