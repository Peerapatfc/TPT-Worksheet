// TPT taxonomy — the exact, allowed strings for subject areas and tags.
// These mirror Teachers Pay Teachers' selectable leaf nodes; the brainstorm step
// constrains the LLM to these values and filters anything off-list afterward.

export const TPT_SUBJECT_AREAS = [
  // Art
  'Art', 'Art History', 'Coloring Pages', 'Graphic Arts', 'Visual Arts', 'Other (Arts)',
  // English Language Arts
  'English Language Arts', 'Alphabet', 'Balanced Literacy', 'Close Reading', 'Creative Writing', 'ELA Test Prep',
  'Grammar', 'Handwriting', 'Informational Text', 'Library Skills', 'Literature',
  'Novel Studies', 'Phonics & Phonological Awareness', 'Poetry', 'Reading',
  'Reading Strategies', 'Science of Reading', 'Short Stories', 'Sight Words',
  'Spelling', 'Vocabulary', 'Writing', 'Writing-Essays', 'Writing-Expository', 'Other (ELA)',
  // Health
  'Health',
  // Math
  'Math', 'Algebra', 'Algebra 2', 'Applied Math', 'Arithmetic', 'Basic Operations', 'Calculus',
  'Decimals', 'Financial Literacy', 'Fractions', 'Geometry', 'Graphing', 'Math Test Prep',
  'Measurement', 'Mental Math', 'Money Math', 'Numbers', 'Order of Operations',
  'Place Value', 'PreCalculus', 'Statistics', 'Telling Time', 'Other (Math)',
  // Performing Arts
  'Performing Arts', 'Dance', 'Drama', 'Instrumental Music', 'Music', 'Music Composition', 'Vocal Music',
  'Other (Performing Arts)',
  // Physical Education
  'Physical Education',
  // Science
  'Science', 'Anatomy', 'Archaeology', 'Astronomy', 'Basic Principles', 'Biology', 'Chemistry',
  'Computer Science - Technology', 'Earth Sciences', 'Engineering', 'Environment',
  'Family Consumer Sciences', 'Forensics', 'General Science', 'Instructional Technology',
  'Marine Science', 'Physical Science', 'Physics', 'Robotics', 'Other (Science)',
  // Social Emotional
  'Social Emotional', 'Character Education', 'Classroom Community', 'School Counseling', 'School Psychology',
  'Social Emotional Learning',
  // Social Studies
  'Social Studies', 'AAPI History', 'African History', 'Ancient History', 'Asian Studies', 'Australian History',
  'Black History', 'British History', 'Business', 'Canadian History', 'Civics',
  'Criminal Justice - Law', 'Economics', 'Elections - Voting', 'European History',
  'Geography', 'Government', 'Latino and Hispanic Studies', 'Middle Ages', 'Native Americans',
  'Psychology', 'Religion', 'U.S. History', 'World History', 'Other (Social Studies)',
  // Speaking & Listening
  'Speaking & Listening',
  // World Languages
  'World Languages', 'American Sign Language', 'Arabic', 'Chinese', 'French', 'Gaeilge', 'German', 'Hebrew',
  'Italian', 'Japanese', 'Latin', 'Portuguese', 'Russian', 'Spanish', 'Other (World Language)',
  // Cross-subject
  'For All Subjects', 'Not Subject Specific',
]

export const TPT_TAGS = [
  // Audience
  'Homeschool', 'Parents', 'Staff & Administrators', 'TPT Sellers',
  // Language
  'En español', 'En français', 'English (UK)',
  // Programs & Methods
  'Advanced Placement (AP)', 'Early Intervention', 'GATE / Gifted and Talented',
  'International Baccalaureate (IB)', 'Montessori',
  // Resource Type — Classroom Decor
  'Bulletin Board Ideas', 'Posters', 'Word Walls',
  // Resource Type — Clip Art
  'Clip Art',
  // Resource Type — Forms
  'Classroom Forms', 'Elective Course Proposals', 'Grant Proposals',
  'Professional Documents', 'School Nurse Documents', 'Student Council',
  // Resource Type — Hands-on Activities
  'Activities', 'Bell Ringers', 'Centers', 'Cultural Activities', 'DBQs',
  'Escape Rooms', 'Games', 'Internet Activities', 'Laboratory', 'Literature Circles',
  'Project-based Learning', 'Projects', 'Research', 'Scripts', 'Simulations',
  'Songs', 'Webquests',
  // Resource Type — Instruction
  'Bibliographies', 'Guided Reading Books', 'Handouts', 'Interactive Notebooks',
  'Scaffolded Notes', 'Printables',
  // Resource Type — Student Assessment
  'Assessment', 'Critical Thinking and Problem Solving', 'Study Guides',
  'Study Skills', 'Test Preparation',
  // Resource Type — Student Practice
  'Flash Cards', 'Graphic Organizers', 'Homework', 'Independent Work Packet',
  'Movie Guides', 'Task Cards', 'Workbooks', 'Worksheets',
  // Resource Type — Teacher Tools
  'Awards and Certificates', 'Classroom Management', 'Homeschool Curricula',
  'Leadership Lessons', 'Lectures', 'Lessons', 'Outlines',
  'Reflective Journals for Teachers', 'Rubrics', 'Syllabi', 'Teacher Manuals',
  'Teacher Planners', 'Thematic Unit Plans', 'Tools for Common Core',
  'Tools for Sellers', 'Unit Plans', 'Yearlong Curriculum',
  // Supports
  'ESL, EFL, and ELL',
  'Applied Behavior Analysis', 'Data', 'Life Skills', 'Neurodiversity',
  'Screenings and Assessments', 'Social Skills', 'Visual Supports', 'Other (Special education)',
  'Career and Technical Education', 'Child Care', 'Coaching', 'Cooking', 'Leadership',
  'Occupational Therapy', 'Physical Therapy', 'Professional Development',
  'Service Learning', 'Vocational Education', 'Other (Specialty)',
  'AAC', 'Fluency and Stuttering', 'Language', 'Speech Articulation', 'Voice',
  'Other (Speech therapy)',
  // Theme — Holiday
  "AAPI History Month", "April Fools' Day", 'Arbor Day', 'Black History Month',
  'Christmas-Chanukah-Kwanzaa', 'Cinco de Mayo', 'Day of the Dead / Dia de los Muertos',
  'Diwali', 'Earth Day', 'Easter', "Father's Day", 'Groundhog Day', 'Halloween',
  'Hispanic Heritage Month', 'July 4/Independence Day', 'Juneteenth', 'Labor Day',
  'Lunar New Year', 'Mardi Gras', 'Martin Luther King Day', 'Memorial Day',
  "Mother's Day", 'New Year', 'Passover', "Presidents' Day", 'Ramadan',
  "St. Patrick's Day", 'Thanksgiving', "Valentine's Day", 'Veterans Day',
  "Women's History Month",
  // Theme — Seasonal
  'Autumn', 'Back to School', 'End of Year', 'Spring', 'Summer', 'Winter',
]
