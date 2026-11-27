// Exact Groq request bodies the legacy (PAGE_RENDERER unset) content + recheck steps sent
// before the hybrid content step was added — captured from origin/master 48f251c with a stubbed fetch.
// test/legacy-content-snapshot.test.js asserts the default path still sends these byte for byte.
export default [
  {
    "model": "openai/gpt-oss-120b",
    "max_tokens": 8000,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "generate_page_content",
          "description": "Generate questions and image specifications for worksheet pages",
          "parameters": {
            "type": "object",
            "properties": {
              "pages": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "pageNum": {
                      "type": "integer"
                    },
                    "title": {
                      "type": "string"
                    },
                    "imageSpec": {
                      "type": "string",
                      "description": "Exact visual data spec, or empty string if no visualization (always empty when chart is set)"
                    },
                    "chart": {
                      "type": "object",
                      "description": "ONLY for a picture graph, bar graph, or simple category/number table. Drawn exactly by code — omit for every other page.",
                      "properties": {
                        "type": {
                          "type": "string",
                          "enum": [
                            "pictograph",
                            "bar",
                            "table"
                          ]
                        },
                        "title": {
                          "type": "string"
                        },
                        "icon": {
                          "type": "string",
                          "enum": [
                            "circle",
                            "star",
                            "square",
                            "heart",
                            "triangle"
                          ],
                          "description": "pictograph only"
                        },
                        "unit": {
                          "type": "string",
                          "description": "singular noun one icon/unit stands for, e.g. \"acorn\""
                        },
                        "labelHeader": {
                          "type": "string",
                          "description": "table only: first column header"
                        },
                        "valueHeader": {
                          "type": "string",
                          "description": "table only: second column header"
                        },
                        "categories": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "label": {
                                "type": "string"
                              },
                              "value": {
                                "type": "integer"
                              }
                            },
                            "required": [
                              "label",
                              "value"
                            ]
                          }
                        }
                      },
                      "required": [
                        "type",
                        "title",
                        "categories"
                      ]
                    },
                    "questions": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "num": {
                            "type": "integer"
                          },
                          "question": {
                            "type": "string"
                          },
                          "answer": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "num",
                          "question",
                          "answer"
                        ]
                      }
                    }
                  },
                  "required": [
                    "pageNum",
                    "title",
                    "imageSpec",
                    "questions"
                  ]
                }
              }
            },
            "required": [
              "pages"
            ]
          }
        }
      }
    ],
    "tool_choice": {
      "type": "function",
      "function": {
        "name": "generate_page_content"
      }
    },
    "messages": [
      {
        "role": "user",
        "content": "You are a curriculum designer creating printable worksheets for Teachers Pay Teachers.\n\nSet: \"Autumn Math Adventures\"\nGrade: Grade 2\nSubject: Math\n\nFor each worksheet/activity page, follow TWO steps in order:\n\nSTEP 1 — Define imageSpec (exact visual blueprint):\nIf the page needs a data visualization, define ALL values precisely so an AI image generator can draw it exactly:\n- Picture graphs, bar graphs, and simple category/number tables: do NOT describe them in imageSpec. Fill \"chart\" instead — code draws it exactly, so the answer key always matches. Whole numbers only; picture graph ≤6 categories and ≤12 per category (one icon = 1 unit), bar graph ≤6 bars with values ≤20, table ≤8 rows. If the data needs bigger numbers than those limits (e.g. 40 or 50 units), use a table instead of a bar/picture graph. Leave imageSpec \"\" on chart pages. Every question on a chart page must be answerable by reading the chart.\n- Never plan pie charts, line graphs, double/grouped bar graphs, or \"find the mistake in this graph\" pages: code draws only one-series picture graphs, bar graphs and tables, and the image model cannot draw the others with correct values. Use a single-series chart or table with questions on the same data.\n- Number sequences / patterns: list every term explicitly\n- Matching activities (draw-a-line): list left column items top-to-bottom, then list right column items in a SHUFFLED order (NOT the same order as left column) so correct answers require diagonal or non-straight lines. Specify both columns explicitly: \"Left (top to bottom): A, B, C, D. Right (top to bottom, shuffled): C, A, D, B.\" Every left item MUST have its correct match among the right items — never list a quote, term or picture whose answer is not in the other column.\n- Quotations: only use a quotation if you are certain of the speaker, and only attribute it to someone in the activity. Questions may only quote text that the imageSpec prints.\nAVOID visual types that AI cannot render accurately:\n- Base-10 blocks with subdivisions (use text \"3 tens 2 ones\" format instead)\n- Analog clocks with exact hand positions\n- Protractors, rulers with exact measurements\n- Geometric shapes requiring precise angles/dimensions\n- Crossword puzzles, word searches, mazes, dot-to-dot (grids and paths cannot be drawn consistently). If a page description asks for one, make it a matching, fill-in-the-blank, or labeling activity on the same content instead.\nimageSpec describes only what is printed on the STUDENT page — never include answers (no \"– COB\" after a clue, no filled-in blanks, no lines already drawn between matches).\nFor pages with NO data visualization (pure text questions, writing prompts): set imageSpec to \"\"\n\nSTEP 2 — Generate Q&A from your imageSpec:\n- Every answer must be derivable from the exact data in imageSpec\n- 4–6 questions per page, appropriate for Grade 2\n- For Math: use exact numbers from imageSpec. For ELA: clear sentence prompts. For Science/Social Studies: fact-based.\n- All answers must be factually and academically correct.\n- Every question must have exactly ONE correct answer that can be checked against the imageSpec or established facts.\n- Do NOT ask opinion or guessing questions (\"Who is likely to…\", \"What do you think…\", \"Which is your favorite…\").\n- Knowledge questions are fine (e.g. \"Which habitat does the wolf spider live in?\"). Only avoid questions that ask the student to READ a visual detail the imageSpec does not define (e.g. who is speaking when the speakers aren't specified).\n- Avoid negative questions (\"Which direction does X NOT…\", \"Which is not…\") unless exactly one option fits.\n- For open-ended \"why/explain\" questions, give one concise model answer.\n- Never ask about the student's own drawing, collection, collage, story, observations or experience (\"your leaf\", \"Draw a leaf you saw\", \"Did you include…\", \"Write a sentence about your…\"). The answer key must hold ONE concrete correct answer for every question, so a page may not depend on what a student draws, collects or writes. Ask knowledge or picture-reading questions instead.\n- Use only words a Grade 2 student can read and understand. Avoid technical terms (e.g. photosynthesis, glucose, by-product, chlorophyll) unless the page itself defines them in the imageSpec; prefer everyday wording.\n- Picture matching (pictures on one side, names on the other): every picture must be unmistakably different from the others in shape and colour, and a student must be able to tell which name belongs to it. Do not match look-alike items that only an expert can tell apart (e.g. different leaf species by outline) — the image generator cannot draw those reliably.\n\nPages:\n- Page 2 (worksheet): Addition word problems with pumpkins.\n- Page 3 (activity): A matching activity: numbers to number words.\n\nCall the generate_page_content function with content for all pages."
      }
    ]
  },
  {
    "model": "openai/gpt-oss-120b",
    "max_tokens": 8000,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "generate_page_content",
          "description": "Generate questions and image specifications for worksheet pages",
          "parameters": {
            "type": "object",
            "properties": {
              "pages": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "pageNum": {
                      "type": "integer"
                    },
                    "title": {
                      "type": "string"
                    },
                    "imageSpec": {
                      "type": "string",
                      "description": "Exact visual data spec, or empty string if no visualization (always empty when chart is set)"
                    },
                    "chart": {
                      "type": "object",
                      "description": "ONLY for a picture graph, bar graph, or simple category/number table. Drawn exactly by code — omit for every other page.",
                      "properties": {
                        "type": {
                          "type": "string",
                          "enum": [
                            "pictograph",
                            "bar",
                            "table"
                          ]
                        },
                        "title": {
                          "type": "string"
                        },
                        "icon": {
                          "type": "string",
                          "enum": [
                            "circle",
                            "star",
                            "square",
                            "heart",
                            "triangle"
                          ],
                          "description": "pictograph only"
                        },
                        "unit": {
                          "type": "string",
                          "description": "singular noun one icon/unit stands for, e.g. \"acorn\""
                        },
                        "labelHeader": {
                          "type": "string",
                          "description": "table only: first column header"
                        },
                        "valueHeader": {
                          "type": "string",
                          "description": "table only: second column header"
                        },
                        "categories": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "label": {
                                "type": "string"
                              },
                              "value": {
                                "type": "integer"
                              }
                            },
                            "required": [
                              "label",
                              "value"
                            ]
                          }
                        }
                      },
                      "required": [
                        "type",
                        "title",
                        "categories"
                      ]
                    },
                    "questions": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "num": {
                            "type": "integer"
                          },
                          "question": {
                            "type": "string"
                          },
                          "answer": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "num",
                          "question",
                          "answer"
                        ]
                      }
                    }
                  },
                  "required": [
                    "pageNum",
                    "title",
                    "imageSpec",
                    "questions"
                  ]
                }
              }
            },
            "required": [
              "pages"
            ]
          }
        }
      }
    ],
    "tool_choice": {
      "type": "function",
      "function": {
        "name": "generate_page_content"
      }
    },
    "messages": [
      {
        "role": "user",
        "content": "You are a curriculum designer creating printable worksheets for Teachers Pay Teachers.\n\nSet: \"Autumn Math Adventures\"\nGrade: Grade 2\nSubject: Math\n\nFor each worksheet/activity page, follow TWO steps in order:\n\nSTEP 1 — Define imageSpec (exact visual blueprint):\nIf the page needs a data visualization, define ALL values precisely so an AI image generator can draw it exactly:\n- Picture graphs, bar graphs, and simple category/number tables: do NOT describe them in imageSpec. Fill \"chart\" instead — code draws it exactly, so the answer key always matches. Whole numbers only; picture graph ≤6 categories and ≤12 per category (one icon = 1 unit), bar graph ≤6 bars with values ≤20, table ≤8 rows. If the data needs bigger numbers than those limits (e.g. 40 or 50 units), use a table instead of a bar/picture graph. Leave imageSpec \"\" on chart pages. Every question on a chart page must be answerable by reading the chart.\n- Never plan pie charts, line graphs, double/grouped bar graphs, or \"find the mistake in this graph\" pages: code draws only one-series picture graphs, bar graphs and tables, and the image model cannot draw the others with correct values. Use a single-series chart or table with questions on the same data.\n- Number sequences / patterns: list every term explicitly\n- Matching activities (draw-a-line): list left column items top-to-bottom, then list right column items in a SHUFFLED order (NOT the same order as left column) so correct answers require diagonal or non-straight lines. Specify both columns explicitly: \"Left (top to bottom): A, B, C, D. Right (top to bottom, shuffled): C, A, D, B.\" Every left item MUST have its correct match among the right items — never list a quote, term or picture whose answer is not in the other column.\n- Quotations: only use a quotation if you are certain of the speaker, and only attribute it to someone in the activity. Questions may only quote text that the imageSpec prints.\nAVOID visual types that AI cannot render accurately:\n- Base-10 blocks with subdivisions (use text \"3 tens 2 ones\" format instead)\n- Analog clocks with exact hand positions\n- Protractors, rulers with exact measurements\n- Geometric shapes requiring precise angles/dimensions\n- Crossword puzzles, word searches, mazes, dot-to-dot (grids and paths cannot be drawn consistently). If a page description asks for one, make it a matching, fill-in-the-blank, or labeling activity on the same content instead.\nimageSpec describes only what is printed on the STUDENT page — never include answers (no \"– COB\" after a clue, no filled-in blanks, no lines already drawn between matches).\nFor pages with NO data visualization (pure text questions, writing prompts): set imageSpec to \"\"\n\nSTEP 2 — Generate Q&A from your imageSpec:\n- Every answer must be derivable from the exact data in imageSpec\n- 4–6 questions per page, appropriate for Grade 2\n- For Math: use exact numbers from imageSpec. For ELA: clear sentence prompts. For Science/Social Studies: fact-based.\n- All answers must be factually and academically correct.\n- Every question must have exactly ONE correct answer that can be checked against the imageSpec or established facts.\n- Do NOT ask opinion or guessing questions (\"Who is likely to…\", \"What do you think…\", \"Which is your favorite…\").\n- Knowledge questions are fine (e.g. \"Which habitat does the wolf spider live in?\"). Only avoid questions that ask the student to READ a visual detail the imageSpec does not define (e.g. who is speaking when the speakers aren't specified).\n- Avoid negative questions (\"Which direction does X NOT…\", \"Which is not…\") unless exactly one option fits.\n- For open-ended \"why/explain\" questions, give one concise model answer.\n- Never ask about the student's own drawing, collection, collage, story, observations or experience (\"your leaf\", \"Draw a leaf you saw\", \"Did you include…\", \"Write a sentence about your…\"). The answer key must hold ONE concrete correct answer for every question, so a page may not depend on what a student draws, collects or writes. Ask knowledge or picture-reading questions instead.\n- Use only words a Grade 2 student can read and understand. Avoid technical terms (e.g. photosynthesis, glucose, by-product, chlorophyll) unless the page itself defines them in the imageSpec; prefer everyday wording.\n- Picture matching (pictures on one side, names on the other): every picture must be unmistakably different from the others in shape and colour, and a student must be able to tell which name belongs to it. Do not match look-alike items that only an expert can tell apart (e.g. different leaf species by outline) — the image generator cannot draw those reliably.\n\nPages:\n- Page 2 (worksheet): Addition word problems with pumpkins.\n- Page 3 (activity): A matching activity: numbers to number words.\n\nCall the generate_page_content function with content for all pages."
      }
    ]
  },
  {
    "model": "openai/gpt-oss-120b",
    "max_tokens": 8000,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "generate_page_content",
          "description": "Generate questions and image specifications for worksheet pages",
          "parameters": {
            "type": "object",
            "properties": {
              "pages": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "pageNum": {
                      "type": "integer"
                    },
                    "title": {
                      "type": "string"
                    },
                    "imageSpec": {
                      "type": "string",
                      "description": "Exact visual data spec, or empty string if no visualization (always empty when chart is set)"
                    },
                    "chart": {
                      "type": "object",
                      "description": "ONLY for a picture graph, bar graph, or simple category/number table. Drawn exactly by code — omit for every other page.",
                      "properties": {
                        "type": {
                          "type": "string",
                          "enum": [
                            "pictograph",
                            "bar",
                            "table"
                          ]
                        },
                        "title": {
                          "type": "string"
                        },
                        "icon": {
                          "type": "string",
                          "enum": [
                            "circle",
                            "star",
                            "square",
                            "heart",
                            "triangle"
                          ],
                          "description": "pictograph only"
                        },
                        "unit": {
                          "type": "string",
                          "description": "singular noun one icon/unit stands for, e.g. \"acorn\""
                        },
                        "labelHeader": {
                          "type": "string",
                          "description": "table only: first column header"
                        },
                        "valueHeader": {
                          "type": "string",
                          "description": "table only: second column header"
                        },
                        "categories": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "properties": {
                              "label": {
                                "type": "string"
                              },
                              "value": {
                                "type": "integer"
                              }
                            },
                            "required": [
                              "label",
                              "value"
                            ]
                          }
                        }
                      },
                      "required": [
                        "type",
                        "title",
                        "categories"
                      ]
                    },
                    "questions": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "num": {
                            "type": "integer"
                          },
                          "question": {
                            "type": "string"
                          },
                          "answer": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "num",
                          "question",
                          "answer"
                        ]
                      }
                    }
                  },
                  "required": [
                    "pageNum",
                    "title",
                    "imageSpec",
                    "questions"
                  ]
                }
              }
            },
            "required": [
              "pages"
            ]
          }
        }
      }
    ],
    "tool_choice": {
      "type": "function",
      "function": {
        "name": "generate_page_content"
      }
    },
    "messages": [
      {
        "role": "user",
        "content": "You are a curriculum designer creating printable worksheets for Teachers Pay Teachers.\n\nSet: \"Autumn Math Adventures\"\nGrade: Grade 2\nSubject: Math\n\nFor each worksheet/activity page, follow TWO steps in order:\n\nSTEP 1 — Define imageSpec (exact visual blueprint):\nIf the page needs a data visualization, define ALL values precisely so an AI image generator can draw it exactly:\n- Picture graphs, bar graphs, and simple category/number tables: do NOT describe them in imageSpec. Fill \"chart\" instead — code draws it exactly, so the answer key always matches. Whole numbers only; picture graph ≤6 categories and ≤12 per category (one icon = 1 unit), bar graph ≤6 bars with values ≤20, table ≤8 rows. If the data needs bigger numbers than those limits (e.g. 40 or 50 units), use a table instead of a bar/picture graph. Leave imageSpec \"\" on chart pages. Every question on a chart page must be answerable by reading the chart.\n- Never plan pie charts, line graphs, double/grouped bar graphs, or \"find the mistake in this graph\" pages: code draws only one-series picture graphs, bar graphs and tables, and the image model cannot draw the others with correct values. Use a single-series chart or table with questions on the same data.\n- Number sequences / patterns: list every term explicitly\n- Matching activities (draw-a-line): list left column items top-to-bottom, then list right column items in a SHUFFLED order (NOT the same order as left column) so correct answers require diagonal or non-straight lines. Specify both columns explicitly: \"Left (top to bottom): A, B, C, D. Right (top to bottom, shuffled): C, A, D, B.\" Every left item MUST have its correct match among the right items — never list a quote, term or picture whose answer is not in the other column.\n- Quotations: only use a quotation if you are certain of the speaker, and only attribute it to someone in the activity. Questions may only quote text that the imageSpec prints.\nAVOID visual types that AI cannot render accurately:\n- Base-10 blocks with subdivisions (use text \"3 tens 2 ones\" format instead)\n- Analog clocks with exact hand positions\n- Protractors, rulers with exact measurements\n- Geometric shapes requiring precise angles/dimensions\n- Crossword puzzles, word searches, mazes, dot-to-dot (grids and paths cannot be drawn consistently). If a page description asks for one, make it a matching, fill-in-the-blank, or labeling activity on the same content instead.\nimageSpec describes only what is printed on the STUDENT page — never include answers (no \"– COB\" after a clue, no filled-in blanks, no lines already drawn between matches).\nFor pages with NO data visualization (pure text questions, writing prompts): set imageSpec to \"\"\n\nSTEP 2 — Generate Q&A from your imageSpec:\n- Every answer must be derivable from the exact data in imageSpec\n- 4–6 questions per page, appropriate for Grade 2\n- For Math: use exact numbers from imageSpec. For ELA: clear sentence prompts. For Science/Social Studies: fact-based.\n- All answers must be factually and academically correct.\n- Every question must have exactly ONE correct answer that can be checked against the imageSpec or established facts.\n- Do NOT ask opinion or guessing questions (\"Who is likely to…\", \"What do you think…\", \"Which is your favorite…\").\n- Knowledge questions are fine (e.g. \"Which habitat does the wolf spider live in?\"). Only avoid questions that ask the student to READ a visual detail the imageSpec does not define (e.g. who is speaking when the speakers aren't specified).\n- Avoid negative questions (\"Which direction does X NOT…\", \"Which is not…\") unless exactly one option fits.\n- For open-ended \"why/explain\" questions, give one concise model answer.\n- Never ask about the student's own drawing, collection, collage, story, observations or experience (\"your leaf\", \"Draw a leaf you saw\", \"Did you include…\", \"Write a sentence about your…\"). The answer key must hold ONE concrete correct answer for every question, so a page may not depend on what a student draws, collects or writes. Ask knowledge or picture-reading questions instead.\n- Use only words a Grade 2 student can read and understand. Avoid technical terms (e.g. photosynthesis, glucose, by-product, chlorophyll) unless the page itself defines them in the imageSpec; prefer everyday wording.\n- Picture matching (pictures on one side, names on the other): every picture must be unmistakably different from the others in shape and colour, and a student must be able to tell which name belongs to it. Do not match look-alike items that only an expert can tell apart (e.g. different leaf species by outline) — the image generator cannot draw those reliably.\n\nPages:\n- Page 2 (worksheet): Addition word problems with pumpkins.\n- Page 3 (activity): A matching activity: numbers to number words.\n\nCall the generate_page_content function with content for all pages."
      }
    ]
  },
  {
    "model": "openai/gpt-oss-120b",
    "max_tokens": 8192,
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "validate_content",
          "description": "Validate and correct worksheet Q&A for academic accuracy",
          "parameters": {
            "type": "object",
            "properties": {
              "pass": {
                "type": "boolean"
              },
              "corrections": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "pageNum": {
                      "type": "integer"
                    },
                    "questionNum": {
                      "type": "integer"
                    },
                    "correctedAnswer": {
                      "type": "string"
                    },
                    "correctedQuestion": {
                      "type": "string",
                      "description": "Rewritten question, only when the original is ambiguous or opinion-based"
                    },
                    "reason": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "pageNum",
                    "questionNum",
                    "correctedAnswer",
                    "reason"
                  ]
                }
              },
              "imageSpecCorrections": {
                "type": "array",
                "description": "Full replacement imageSpec for a page whose rewritten questions or answers depend on something the picture prints (a quote, label, name or number). Omit when no page needs one.",
                "items": {
                  "type": "object",
                  "properties": {
                    "pageNum": {
                      "type": "integer"
                    },
                    "correctedImageSpec": {
                      "type": "string",
                      "description": "The COMPLETE corrected imageSpec for the page, not a diff"
                    },
                    "reason": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "pageNum",
                    "correctedImageSpec",
                    "reason"
                  ]
                }
              }
            },
            "required": [
              "pass",
              "corrections"
            ]
          }
        }
      }
    ],
    "tool_choice": {
      "type": "function",
      "function": {
        "name": "validate_content"
      }
    },
    "messages": [
      {
        "role": "user",
        "content": "You are an academic fact-checker for elementary school worksheets.\n\nSet: \"Autumn Math Adventures\" | Grade: Grade 2 | Subject: Math\n\nReview every question and answer below. For each item check ALL of:\n1. The answer is academically correct (math calculations, spelling, grammar, facts, logic)\n2. The answer actually and specifically answers its question — not just correct in isolation\n3. If the question asks the student to READ data from the picture (counts, chart/table values, labels), its answer must match the exact data in the page's chart (categories/values) or imageSpec (e.g. if the chart says Bananas=7, \"how many bananas?\" must be 7). Questions answered from subject knowledge — e.g. a matching page asking which habitat a spider lives in — do NOT need to be derivable from the imageSpec; only check that the answer is correct.\n4. The question is appropriate in difficulty and vocabulary for Grade 2 level — rewrite it with simpler wording if it uses technical terms (e.g. photosynthesis, glucose, by-product) a student of that grade would not know\n5. The question has exactly ONE correct answer. Flag opinion/guessing questions (\"who is likely…\", \"what do you think…\"), questions that ask the student to read a visual detail the imageSpec doesn't define, and negative questions with several valid answers (e.g. \"Which direction does Alex NOT patrol?\" when three directions fit). Also flag questions about the student's own drawing, collection, story or experience (\"your leaf\", \"Did you include…\", \"Draw a leaf you saw\") — they have no single correct answer. Rewrite each as a knowledge or picture-reading question on the same topic with one verifiable answer — if the page has an empty imageSpec, use a knowledge question that does not refer to any picture, collage or drawing. Knowledge questions whose answer comes from the subject matter rather than the picture are FINE (e.g. a matching page \"Which habitat matches the wolf spider?\") — do not flag them.\n6. If the answer is wrong, mismatched, or inappropriate, provide correctedAnswer.\n7. If the QUESTION itself fails check 5, rewrite it as correctedQuestion (same skill, topic and difficulty, one verifiable answer) and give its correctedAnswer. Never answer an ambiguous question with \"not specified\" or \"it depends\" — rewrite the question instead. Never rewrite a question into one about layout or position on the page (e.g. \"Is X shown at the top of the column?\").\n8. The picture is drawn from each page's imageSpec and printed on the student page, so a question may only quote or name what the imageSpec prints. If you rewrite a question or change an answer so that it depends on a quote, label, name or number that the imageSpec does not contain, ALSO return the page's complete corrected imageSpec in imageSpecCorrections. On matching pages every left-column item must have its correct match in the right column (e.g. if a quote's speaker is not among the listed figures, replace the quote in the imageSpec and the question together).\n9. Check the attribution of every quotation. If you are not certain who said it, replace it with a well-documented quotation by one of the listed figures (and update the imageSpec to match).\n\n[\n  {\n    \"pageNum\": 2,\n    \"title\": \"T\",\n    \"imageSpec\": \"\",\n    \"questions\": [\n      {\n        \"num\": 1,\n        \"question\": \"What is 1+1?\",\n        \"answer\": \"2\"\n      },\n      {\n        \"num\": 2,\n        \"question\": \"What is 2+1?\",\n        \"answer\": \"3\"\n      },\n      {\n        \"num\": 3,\n        \"question\": \"What is 3+1?\",\n        \"answer\": \"4\"\n      },\n      {\n        \"num\": 4,\n        \"question\": \"What is 4+1?\",\n        \"answer\": \"5\"\n      }\n    ]\n  }\n]\n\nCall the validate_content function with your assessment."
      }
    ]
  }
]
