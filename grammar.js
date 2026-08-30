/**
 * @file Tree-sitter grammar for Statamic Antlers templates
 * @author John Koster
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

const PATH = /(?:\$\$?|@)?[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*(?:(?::|\.|->|\/)[@$]?[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*)*/;
const EXPLICIT_TAG = /%[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*(?:(?::|\.|->|\/)[@$]?[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*)*/;
const MODIFIER_NAME = /[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/;

const antlersTagContent = $ => seq(
  optional($._whitespace),
  optional(choice(
    seq(
      field('closing', $.closing_marker),
      optional($._whitespace),
      optional(field('body', $.tag_body)),
    ),
    field('body', $.tag_body),
  )),
);

module.exports = grammar({
  name: 'antlers',

  extras: _ => [],

  externals: $ => [
    $._if_open_delimiter,
    $._unless_open_delimiter,
    $._elseif_delimiter,
    $._elseunless_delimiter,
    $._else_delimiter,
    $._if_close_delimiter,
    $._unless_close_delimiter,
    $._tag_pair_open_delimiter,
    $._tag_pair_close_delimiter,
    $._noparse_open_delimiter,
    $.noparse_content,
    $._noparse_close_delimiter,
    $._method_receiver,
    $._method_accessor,
    $._directive_name_with_arguments,
    $._bare_cascade_name,
    $._tag_recovery_boundary,
    $._end_of_file,
  ],

  word: $ => $.path,

  conflicts: $ => [
    [$._if_conditional, $._incomplete_if_conditional],
    [$._unless_conditional, $._incomplete_unless_conditional],
    [$.conditional_body, $._incomplete_conditional_body],
    [$.parameter_prefix, $.operator],
    [$.ignored_parameter_prefix, $.operator],
    [$.modifier, $.operator],
    [$.parameter, $._head_component],
    [$.subscript_expression, $.array],
    [$._head_component, $.dynamic_tag_name],
    [$._head_component, $.subscript_expression],
    [$.subscript_expression, $.group],
    [$.subscript_expression, $.subscript],
    [$._parameter_value, $.subscript_expression],
    [$._ignored_parameter_value, $.subscript_expression],
  ],

  rules: {
    document: $ => seq(
      optional($.front_matter),
      repeat($._node),
    ),

    // Statamic templates may begin with YAML front matter. Keeping the YAML
    // payload as a named node lets editors inject their native YAML grammar.
    front_matter: $ => seq(
      field('open', alias($._front_matter_delimiter, $.front_matter_delimiter)),
      $._newline,
      optional(field('content', $.front_matter_content)),
      field('close', alias($._front_matter_delimiter, $.front_matter_delimiter)),
      optional($._newline),
    ),

    _front_matter_delimiter: _ => token('---'),
    _newline: _ => /\r?\n/,

    // Parse whole lines so a value containing `---` does not terminate the
    // block. The lower token precedence lets a delimiter at the beginning of
    // a line win over an otherwise valid YAML content line.
    front_matter_content: $ => repeat1(seq(
      optional($._front_matter_line),
      $._newline,
    )),

    _front_matter_line: _ => token(prec(-1, /[^\r\n]+/)),

    _node: $ => choice(
      $.escaped_antlers,
      $.escaped_directive,
      $.comment,
      $.php_statement,
      $.php_echo,
      $.noparse,
      $.conditional,
      $.tag_pair,
      $.antlers_tag,
      $.antlers_directive,
      $.text,
    ),

    // Conditions are structural so editors can indent, outline, fold, and
    // navigate the complete block. If a condition is incomplete, the generic
    // antlers_tag rule below remains available as a resilient fallback.
    conditional: $ => choice(
      $._if_conditional,
      $._unless_conditional,
      $._incomplete_if_conditional,
      $._incomplete_unless_conditional,
    ),

    _if_conditional: $ => prec.dynamic(2, seq(
      field('open', alias($._if_open, $.antlers_tag)),
      optional(field('body', $.conditional_body)),
      repeat(seq(
        field('branch', alias($._elseif_tag, $.antlers_tag)),
        optional(field('body', $.conditional_body)),
      )),
      optional(seq(
        field('branch', alias($._else_tag, $.antlers_tag)),
        optional(field('body', $.conditional_body)),
      )),
      field('close', alias($._if_close, $.antlers_tag)),
    )),

    _unless_conditional: $ => prec.dynamic(2, seq(
      field('open', alias($._unless_open, $.antlers_tag)),
      optional(field('body', $.conditional_body)),
      repeat(seq(
        field('branch', alias($._elseunless_tag, $.antlers_tag)),
        optional(field('body', $.conditional_body)),
      )),
      optional(seq(
        field('branch', alias($._else_tag, $.antlers_tag)),
        optional(field('body', $.conditional_body)),
      )),
      field('close', alias($._unless_close, $.antlers_tag)),
    )),

    _incomplete_if_conditional: $ => prec.dynamic(-2, prec.right(seq(
      field('open', alias($._if_open, $.antlers_tag)),
      optional(field('body', alias($._incomplete_conditional_body, $.conditional_body))),
      repeat(seq(
        field('branch', alias($._elseif_tag, $.antlers_tag)),
        optional(field('body', alias($._incomplete_conditional_body, $.conditional_body))),
      )),
      optional(seq(
        field('branch', alias($._else_tag, $.antlers_tag)),
        optional(field('body', alias($._incomplete_conditional_body, $.conditional_body))),
      )),
    ))),

    _incomplete_unless_conditional: $ => prec.dynamic(-2, prec.right(seq(
      field('open', alias($._unless_open, $.antlers_tag)),
      optional(field('body', alias($._incomplete_conditional_body, $.conditional_body))),
      repeat(seq(
        field('branch', alias($._elseunless_tag, $.antlers_tag)),
        optional(field('body', alias($._incomplete_conditional_body, $.conditional_body))),
      )),
      optional(seq(
        field('branch', alias($._else_tag, $.antlers_tag)),
        optional(field('body', alias($._incomplete_conditional_body, $.conditional_body))),
      )),
    ))),

    conditional_body: $ => prec.left(repeat1($._node)),
    _incomplete_conditional_body: $ => prec.right(repeat1($._node)),

    _if_open: $ => seq(
      alias($._if_open_delimiter, '{{'),
      optional($._whitespace),
      field('body', alias($._if_open_body, $.tag_body)),
      '}}',
    ),

    _if_open_body: $ => seq(
      field('head', alias('if', $.keyword)),
      repeat($._tag_component),
    ),

    _unless_open: $ => seq(
      alias($._unless_open_delimiter, '{{'),
      optional($._whitespace),
      field('body', alias($._unless_open_body, $.tag_body)),
      '}}',
    ),

    _unless_open_body: $ => seq(
      field('head', alias('unless', $.keyword)),
      repeat($._tag_component),
    ),

    _elseif_tag: $ => prec(3, seq(
      alias($._elseif_delimiter, '{{'),
      optional($._whitespace),
      field('body', alias($._elseif_body, $.tag_body)),
      '}}',
    )),

    _elseif_body: $ => seq(
      field('head', alias('elseif', $.keyword)),
      repeat($._tag_component),
    ),

    _elseunless_tag: $ => prec(3, seq(
      alias($._elseunless_delimiter, '{{'),
      optional($._whitespace),
      field('body', alias($._elseunless_body, $.tag_body)),
      '}}',
    )),

    _elseunless_body: $ => seq(
      field('head', alias('elseunless', $.keyword)),
      repeat($._tag_component),
    ),

    _else_tag: $ => prec(3, seq(
      alias($._else_delimiter, '{{'),
      optional($._whitespace),
      field('body', alias($._else_body, $.tag_body)),
      optional($._whitespace),
      '}}',
    )),

    _else_body: $ => field('head', alias('else', $.keyword)),

    _if_close: $ => choice(
      seq(
        alias($._if_close_delimiter, '{{'),
        optional($._whitespace),
        field('closing', $.closing_marker),
        optional($._whitespace),
        field('body', alias($._if_close_body, $.tag_body)),
        optional($._whitespace),
        '}}',
      ),
      seq(
        alias($._if_close_delimiter, '{{'),
        optional($._whitespace),
        field('body', alias($._endif_body, $.tag_body)),
        optional($._whitespace),
        '}}',
      ),
    ),

    _if_close_body: $ => field('head', alias('if', $.keyword)),
    _endif_body: $ => field('head', alias('endif', $.keyword)),

    _unless_close: $ => choice(
      seq(
        alias($._unless_close_delimiter, '{{'),
        optional($._whitespace),
        field('closing', $.closing_marker),
        optional($._whitespace),
        field('body', alias($._unless_close_body, $.tag_body)),
        optional($._whitespace),
        '}}',
      ),
      seq(
        alias($._unless_close_delimiter, '{{'),
        optional($._whitespace),
        field('body', alias($._endunless_body, $.tag_body)),
        optional($._whitespace),
        '}}',
      ),
    ),

    _unless_close_body: $ => field('head', alias('unless', $.keyword)),
    _endunless_body: $ => field('head', alias('endunless', $.keyword)),

    // The contents of a noparse pair are literal template text. Keeping the
    // region opaque prevents executable-looking Antlers inside it from being
    // highlighted, indented, or exposed as editor structure.
    noparse: $ => choice(
      prec.dynamic(3, seq(
        field('open', alias($._noparse_open, $.antlers_tag)),
        optional(field('body', $.noparse_content)),
        field('close', alias($._noparse_close, $.antlers_tag)),
      )),
      // Keep an unfinished region opaque through end-of-file. This mirrors
      // Antlers' parser and avoids a flash of executable highlighting while
      // the closing tag is still being typed.
      prec.dynamic(-1, prec.right(seq(
        field('open', alias($._noparse_open, $.antlers_tag)),
        optional(field('body', $.noparse_content)),
      ))),
    ),

    _noparse_open: $ => seq(
      alias($._noparse_open_delimiter, '{{'),
      optional($._whitespace),
      field('body', alias($._noparse_body, $.tag_body)),
      '}}',
    ),

    _noparse_close: $ => seq(
      alias($._noparse_close_delimiter, '{{'),
      optional($._whitespace),
      field('closing', $.closing_marker),
      optional($._whitespace),
      field('body', alias($._noparse_close_body, $.tag_body)),
      optional($._whitespace),
      '}}',
    ),

    _noparse_body: $ => seq(
      field('head', alias('noparse', $.path)),
      repeat($._tag_component),
    ),

    _noparse_close_body: $ => field('head', alias('noparse', $.path)),

    // Any Antlers tag can be used as a pair, including add-on tags unknown to
    // this grammar. The external scanner records the opening head and only
    // emits the closing delimiter when the names match exactly. A normal
    // antlers_tag remains available in parallel, so variables, single tags,
    // and incomplete edits do not consume the rest of the document as a
    // speculative block.
    tag_pair: $ => prec.dynamic(1, seq(
      field('open', alias($._tag_pair_open, $.antlers_tag)),
      optional(field('body', $.tag_pair_body)),
      field('close', alias($._tag_pair_close, $.antlers_tag)),
    )),

    tag_pair_body: $ => repeat1($._node),

    _tag_pair_open: $ => seq(
      alias($._tag_pair_open_delimiter, '{{'),
      optional($._whitespace),
      field('body', $.tag_body),
      '}}',
    ),

    _tag_pair_close: $ => seq(
      alias($._tag_pair_close_delimiter, '{{'),
      optional($._whitespace),
      field('closing', $.closing_marker),
      optional($._whitespace),
      field('body', $.tag_body),
      '}}',
    ),

    // Consumers can combine these ranges and reparse them with a host grammar.
    text: _ => token(prec(-1, choice(
      repeat1(choice(
        /[^{}@<]+/,
        /<[^?]/,
      )),
      '<',
      '@',
      '{',
      /}+/,
    ))),

    // A leading @ escapes an Antlers region and must remain literal template
    // text instead of being parsed and highlighted as an executable tag.
    escaped_antlers: _ => token(seq(
      '@{{',
      repeat(choice(
        /[^}]+/,
        /}[^}]/,
      )),
      '}}',
    )),

    // Component directives live outside `{{ ... }}`. Props and aware always
    // require arguments, while cascade can be used as a bare directive. A
    // doubled at-sign is Statamic's literal escape and must never expose the
    // following name as an executable directive.
    antlers_directive: $ => choice(
      seq(
        field('name', alias($._directive_name_with_arguments, $.directive_name)),
        optional($._whitespace),
        field('arguments', $.group),
      ),
      field('name', alias($._bare_cascade_name, $.directive_name)),
    ),

    escaped_directive: _ => token(prec(5, choice(
      '@@props',
      '@@aware',
      '@@cascade',
    ))),

    // Keep an unfinished comment opaque through end-of-file. The recovery
    // token cannot cross a real `#}}`: it may consume only a trailing `#` or
    // `#}` fragment, so the longer completed-comment token always wins when
    // the closing delimiter exists.
    comment: _ => choice(
      token(prec(2, seq(
        '{{#',
        repeat(choice(
          /[^#]+/,
          /#[^}]/,
          /#}[^}]/,
        )),
        '#}}',
      ))),
      token(prec(-1, seq(
        '{{#',
        repeat(choice(
          /[^#]+/,
          /#[^}]/,
          /#}[^}]/,
        )),
        optional(choice('#}', '#')),
      ))),
    ),

    php_statement: $ => choice(
      seq(
        '{{?',
        optional(alias($._php_statement_code, $.php_code)),
        '?}}',
      ),
      prec.dynamic(2, seq(
        '<?php',
        optional(alias($._native_php_code, $.php_code)),
        '?>',
      )),
      // Keep native PHP highlighted while its close tag is still being typed.
      prec.dynamic(-2, prec.right(seq(
        '<?php',
        alias($._native_php_code, $.php_code),
      ))),
    ),

    _php_statement_code: _ => token(repeat1(choice(
      /[^?]+/,
      /\?[^}]/,
      /\?}[^}]/,
    ))),

    php_echo: $ => choice(
      seq(
        '{{$',
        optional(alias($._php_echo_code, $.php_code)),
        '$}}',
      ),
      prec.dynamic(2, seq(
        '<?=',
        optional(alias($._native_php_code, $.php_code)),
        '?>',
      )),
      prec.dynamic(-2, prec.right(seq(
        '<?=',
        alias($._native_php_code, $.php_code),
      ))),
    ),

    _php_echo_code: _ => token(repeat1(choice(
      /[^$]+/,
      /\$[^}]/,
      /\$}[^}]/,
    ))),

    _native_php_code: _ => token(repeat1(choice(
      /[^?]+/,
      /\?[^>]/,
    ))),

    antlers_tag: $ => choice(
      prec.dynamic(-1, seq(
        '{{',
        antlersTagContent($),
        choice(
          field('self_closing', $.self_closing_end),
          '}}',
        ),
      )),
      // Preserve the tag body while `}}` is still being typed instead of
      // asking Tree-sitter's error recovery to synthesize a zero-width close.
      // Specialized comments, PHP regions, conditionals, and pairs retain
      // higher-precedence complete or dedicated recovery rules.
      prec.dynamic(-3, prec.right(seq(
        '{{',
        antlersTagContent($),
        choice(
          $._tag_recovery_boundary,
          $._end_of_file,
        ),
      ))),
    ),

    closing_marker: _ => prec(1, '/'),
    self_closing_end: _ => '/}}',

    tag_body: $ => choice(
      seq(
        $.recursive_reference,
        optional($._whitespace),
      ),
      seq(
        field('head', choice(
          $.explicit_tag,
          $.dynamic_tag_name,
          $._head_component,
        )),
        repeat(choice(
          $.shorthand_parameter,
          $.parameter,
          $.modifier,
          $._tag_component,
        )),
      ),
    ),

    // Recursive tags re-enter the nearest recursive pair and are distinct
    // from multiplication expressions. Antlers requires the leading marker
    // to touch `recursive` or `subrecursive`; the target itself may be a
    // compound path, a bracket accessor, or the special array-like form used
    // by nested recursion.
    recursive_reference: $ => prec.dynamic(4, seq(
      field('open', $.recursive_marker),
      field('kind', $.recursive_kind),
      optional($._whitespace),
      field('target', choice(
        $.subscript_expression,
        $.path,
        $.array,
      )),
      optional($._whitespace),
      field('close', $.recursive_marker),
    )),

    recursive_marker: _ => '*',

    recursive_kind: _ => token(prec(4, choice(
      'subrecursive',
      'recursive',
    ))),

    // Parameters deliberately remain separate from general assignment
    // expressions. They can only occur after the tag head and must have a
    // name before the equals sign, which preserves `{{ total = 0 }}` as an
    // expression while grouping `{{ collection from="blog" }}` structurally.
    parameter: $ => choice(
      seq(
        optional(field('prefix', $.parameter_prefix)),
        field('name', $.path),
        optional($._whitespace),
        field('operator', alias('=', $.operator)),
        optional($._whitespace),
        field('value', $._parameter_value),
      ),
      seq(
        field('prefix', $.ignored_parameter_prefix),
        field('name', $.path),
        optional($._whitespace),
        field('operator', alias('=', $.operator)),
        optional($._whitespace),
        field('value', $._ignored_parameter_value),
      ),
    ),

    // A colon enables dynamic binding (`:from="collection"`), while a
    // backslash tells Antlers not to interpolate the parameter value.
    parameter_prefix: _ => ':',

    ignored_parameter_prefix: _ => '\\',

    _ignored_parameter_value: $ => choice(
      $.ignored_string,
      $.number,
      $.boolean,
      $.null,
      $.void,
      $.keyword,
      $.subscript_expression,
      $.path,
    ),

    // `:$name` expands to `:name="name"` inside Statamic. Requiring the
    // dollar sign keeps ordinary ternary `: value` expressions unambiguous.
    shorthand_parameter: _ => token(prec(3, /:\$[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*/i)),

    _parameter_value: $ => choice(
      $.string,
      $.number,
      $.boolean,
      $.null,
      $.void,
      $.keyword,
      $.method_chain,
      $.subscript_expression,
      $.path,
      $.array,
      $.group,
      $.interpolation,
    ),

    // Modifier calls use a dedicated name token so colon-style legacy
    // arguments do not become part of the modifier name. Parenthesized
    // arguments remain a normal group and retain expression highlighting.
    modifier: $ => prec.right(seq(
      field('operator', alias('|', $.operator)),
      optional($._whitespace),
      field('name', $.modifier_name),
      optional(field('arguments', choice(
        $.group,
        $.legacy_modifier_arguments,
      ))),
    )),

    modifier_name: _ => token(prec(2, MODIFIER_NAME)),

    // Antlers' original modifier syntax separates raw arguments with colons.
    // A separator must touch the modifier name or previous value, which keeps
    // `value | modifier : fallback` available to the ternary expression.
    legacy_modifier_arguments: $ => prec.right(repeat1($.legacy_modifier_argument)),

    legacy_modifier_argument: $ => prec.right(seq(
      field('separator', alias(':', $.punctuation)),
      optional($._whitespace),
      field('value', choice(
        $.string,
        $.number,
        $.boolean,
        $.null,
        $.void,
        $.array,
        $.group,
        $.interpolation,
        $.legacy_modifier_value,
      )),
    )),

    // Raw legacy values continue until the next argument, modifier, template
    // delimiter, or symbolic expression operator. Quotes and interpolations
    // are excluded so their normal structured rules can handle embedded `:`
    // and `|` characters without terminating the argument.
    legacy_modifier_value: _ => token(prec(1, /[^:|"'{}\[\]()&!?=<>\s](?:[^:|"'{}\[\]()&!?=<>]*[^:|"'{}\[\]()&!?=<>\s])?/)),

    // Antlers supports method calls through PHP-style arrows as well as dot
    // and colon accessors. The external receiver token looks ahead only far
    // enough to confirm an accessor, method name, and opening parenthesis;
    // ordinary compound paths therefore keep their established path node.
    method_chain: $ => prec.dynamic(3, prec.left(seq(
      field('receiver', alias($._method_receiver, $.path)),
      repeat1(field('method', $.method_invocation)),
    ))),

    method_invocation: $ => prec.left(4, seq(
      field('accessor', alias($._method_accessor, $.operator)),
      field('name', $.method_name),
      field('arguments', $.group),
    )),

    method_name: _ => token(MODIFIER_NAME),

    _tag_component: $ => choice(
      $._head_component,
      $._whitespace,
    ),

    _head_component: $ => choice(
      $.string,
      $.number,
      $.boolean,
      $.null,
      $.void,
      $.keyword,
      $.method_chain,
      $.subscript_expression,
      $.path,
      $.operator,
      $.punctuation,
      $.array,
      $.group,
      $.interpolation,
    ),

    _whitespace: _ => /\s+/,

    // Bracket notation accesses a value by literal or dynamic key. Modeling
    // the base and its indexes together keeps `items[field]` distinct from an
    // adjacent array literal while supporting arbitrarily chained access.
    subscript_expression: $ => prec.dynamic(2, prec.right(seq(
      field('value', $.path),
      repeat1(field('index', $.subscript)),
    ))),

    subscript: $ => seq(
      '[',
      repeat(choice(
        $.string,
        $.number,
        $.boolean,
        $.null,
        $.void,
        $.path,
        $.operator,
        $.punctuation,
        $._whitespace,
        $.array,
        $.group,
        $.interpolation,
        $.subscript_expression,
        $.method_chain,
        $.modifier,
      )),
      ']',
    ),

    array: $ => seq(
      '[',
      repeat(choice(
        $.string,
        $.number,
        $.boolean,
        $.null,
        $.void,
        $.subscript_expression,
        $.path,
        $.operator,
        ',',
        $._whitespace,
        $.array,
        $.group,
        $.interpolation,
        $.method_chain,
        $.modifier,
      )),
      ']',
    ),

    group: $ => seq(
      '(',
      repeat(choice(
        $.string,
        $.number,
        $.boolean,
        $.null,
        $.void,
        $.keyword,
        $.subscript_expression,
        $.path,
        $.operator,
        $.punctuation,
        $._whitespace,
        $.array,
        $.group,
        $.interpolation,
        $.method_chain,
        $.modifier,
      )),
      ')',
    ),

    // Single braces are used for both string interpolation (`{title}`) and
    // independently evaluated tag subexpressions (`{collection:products
    // limit="5"}`). Reusing tag_body preserves the simple form while giving
    // nested tags first-class parameters, modifiers, and function captures.
    interpolation: $ => seq(
      '{',
      optional($._whitespace),
      optional(field('body', $.tag_body)),
      '}',
    ),

    string: $ => choice(
      seq(
        '"',
        repeat(choice(
          alias($._double_string_content, $.string_content),
          alias($._at_string_content, $.string_content),
          $.escape_sequence,
          $.escaped_brace,
          $.antlers_tag,
          $.interpolation,
        )),
        '"',
      ),
      seq(
        "'",
        repeat(choice(
          alias($._single_string_content, $.string_content),
          alias($._at_string_content, $.string_content),
          $.escape_sequence,
          $.escaped_brace,
          $.antlers_tag,
          $.interpolation,
        )),
        "'",
      ),
    ),

    // A backslash-prefixed parameter asks Antlers to preserve the value
    // literally. Braces, nested tags, and interpolation-like text therefore
    // remain opaque string content while ordinary escapes stay recognizable.
    ignored_string: $ => choice(
      seq(
        '"',
        repeat(choice(
          alias($._ignored_double_string_content, $.string_content),
          $.escape_sequence,
        )),
        '"',
      ),
      seq(
        "'",
        repeat(choice(
          alias($._ignored_single_string_content, $.string_content),
          $.escape_sequence,
        )),
        "'",
      ),
    ),

    _double_string_content: _ => token.immediate(prec(1, /[^"\\{@]+/)),
    _single_string_content: _ => token.immediate(prec(1, /[^'\\{@]+/)),
    _at_string_content: _ => token.immediate('@'),
    _ignored_double_string_content: _ => token.immediate(prec(1, /[^"\\]+/)),
    _ignored_single_string_content: _ => token.immediate(prec(1, /[^'\\]+/)),
    escape_sequence: _ => token.immediate(/\\./),
    escaped_brace: _ => token.immediate(choice('@{', '@}')),

    number: _ => token(prec(2, /-?[0-9]+(?:\.[0-9]+)?/)),

    boolean: _ => token(prec(1, choice('true', 'false'))),

    null: _ => token(prec(1, 'null')),

    // `void` removes an interpolated tag parameter instead of producing a
    // runtime value, so it is a language constant rather than a variable.
    void: _ => token(prec(3, 'void')),

    keyword: _ => token(prec(3, choice(
      'if',
      'elseif',
      'else',
      'elseunless',
      'unless',
      'and',
      'or',
      'xor',
      'not',
      'in',
      'is',
      'isnt',
      'contains',
    ))),

    path: _ => token(prec(1, PATH)),

    // Tag methods may interpolate a variable directly into their compound
    // name, for example `collection:{thing}`. Keep this distinct from a
    // normal `path : {subexpression}` sequence so paired dynamic tags retain
    // one exact, outlineable name. Static suffixes between multiple dynamic
    // segments remain supported (`tag:{one}:suffix:{two}`).
    dynamic_tag_name: $ => prec.right(seq(
      field('base', $.path),
      repeat1(seq(
        field('separator', alias(':', $.punctuation)),
        field('open', alias('{', $.punctuation)),
        field('value', $.path),
        field('close', alias('}', $.punctuation)),
        optional(seq(
          field('separator', alias(':', $.punctuation)),
          field('suffix', $.path),
        )),
      )),
    )),

    // `%` forces a reference to resolve as a Tag even when a variable with
    // the same name exists. Keeping it as one node makes the disambiguation
    // deterministic without stealing `%` from arithmetic expressions.
    explicit_tag: _ => token(prec(2, EXPLICIT_TAG)),

    operator: _ => choice(
      '???',
      '??',
      '?=',
      '?:',
      '===',
      '!==',
      '<=>',
      '<=',
      '>=',
      '==',
      '!=',
      '&&',
      '||',
      '|',
      '&=',
      '+=',
      '-=',
      '*=',
      '/=',
      '%=',
      '**',
      '=>',
      '->',
      '=',
      '<',
      '>',
      '+',
      '-',
      '*',
      '/',
      '%',
      '~',
      '&',
      '!',
      '?',
      ':',
      '.',
      '\\',
    ),

    punctuation: _ => choice(
      ',',
      ';',
    ),
  },
});
