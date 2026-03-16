document.addEventListener('DOMContentLoaded', () => {

  const API_BASE = "https://smart-study-backend-uijl.onrender.com";

  const coursesContainer = document.getElementById('courses-container');
  const addDialog = document.getElementById('add-dialog');
  const openAddBtn = document.getElementById('open-add-dialog');
  const closeAddBtn = document.getElementById('close-add-dialog');
  const submitCourseBtn = document.getElementById('submit-course');

  const courseDialog = document.getElementById('course-dialog');
  const closeCourseBtn = document.getElementById('close-course-dialog');
  const courseDialogTitle = document.getElementById('course-dialog-title');
  const chaptersList = document.getElementById('chapters-list');

  const summarySection = document.getElementById('summary-section');
  const summaryText = document.getElementById('summary-text');
  const questionsText = document.getElementById('questions-text');
  const answerInput = document.getElementById('answer-input');
  const submitAnswerBtn = document.getElementById('submit-answer');
  const answerFeedback = document.getElementById('answer-feedback');

  const courseNameInput = document.getElementById('c-name');
  const fileInput = document.getElementById('c-files');
  const datetimeInput = document.getElementById('c-datetime');

  let courses = JSON.parse(localStorage.getItem('courses')) || [];
  let activeCourseId = null;
  let activeChapterIndex = null;

  function saveCourses() {
    localStorage.setItem('courses', JSON.stringify(courses));
  }

  function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substring(2);
  }

  // ===============================
  // ANALYTICS
  // ===============================

  function updateAnalytics() {
    const totalCourses = courses.length;

    const totalChapters = courses.reduce(
      (sum, c) => sum + (c.chapters?.length || 0),
      0
    );

    const completedChapters = courses.reduce(
      (sum, c) => sum + (c.completedChapters?.length || 0),
      0
    );

    let totalAttempts = 0;
    let totalScores = 0;

    courses.forEach(course => {
      Object.values(course.attempts || {}).forEach(scores => {
        totalAttempts += scores.length;
        totalScores += scores.reduce((a, b) => a + b, 0);
      });
    });

    const avgScore = totalAttempts
      ? (totalScores / totalAttempts).toFixed(1)
      : 0;

    const percent = totalChapters
      ? Math.round((completedChapters / totalChapters) * 100)
      : 0;

    document.querySelector('.analytics-stats').innerHTML = `
      <p>Total Courses: ${totalCourses}</p>
      <p>Total Chapters: ${totalChapters}</p>
      <p>Chapters Mastered: ${completedChapters}</p>
      <p>Mastery Progress: ${percent}%</p>
      <p>Total Attempts: ${totalAttempts}</p>
      <p>Average Score: ${avgScore}/10</p>
    `;
  }

  // ===============================
  // ADD COURSE
  // ===============================

  openAddBtn.addEventListener('click', () => {
    addDialog.showModal();
  });

  closeAddBtn.addEventListener('click', () => {
    addDialog.close();
  });

  submitCourseBtn.addEventListener('click', async (e) => {
    e.preventDefault();

    if (!courseNameInput.value.trim()) return alert("Enter course name.");
    if (!fileInput.files[0]) return alert("Upload a .txt file.");
    if (!datetimeInput.value) return alert("Select schedule time.");

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async (event) => {
      const content = event.target.result;

      const formData = new FormData();
      const blob = new Blob([content], { type: 'text/plain' });
      formData.append('file', blob, 'document.txt');

      const response = await fetch(`${API_BASE}/analyze`, {
        method: 'POST',
        body: formData
      });

      const structured = await response.json();

      const newCourse = {
        id: generateId(),
        name: courseNameInput.value.trim(),
        chapters: structured.chapters || [],
        scheduledTime: new Date(datetimeInput.value).toISOString(),
        completedChapters: [],
        attempts: {}
      };

      courses.push(newCourse);
      saveCourses();
      renderCourses();
      updateAnalytics();
      addDialog.close();
    };

    reader.readAsText(file);
  });

  // ===============================
  // RENDER COURSES
  // ===============================

  function renderCourses() {
    coursesContainer.innerHTML = '';

    if (!courses.length) {
      coursesContainer.innerHTML = "<p style='text-align:center; color:#888;'>No courses yet. Click Add New Course to start.</p>";
      return;
    }

    courses.forEach(course => {
      const card = document.createElement('div');
      card.className = 'course-card';

      card.innerHTML = `
        <div class="course-header">
          <h3>${course.name}</h3>
        </div>
        <div class="course-meta">
          Chapters: ${course.chapters.length}
        </div>
        <button class="start-btn">Open</button>
      `;

      card.querySelector('.start-btn')
        .addEventListener('click', () => openCourseDialog(course.id));

      coursesContainer.appendChild(card);
    });
  }

  // ===============================
  // OPEN COURSE
  // ===============================

  function openCourseDialog(courseId) {
    const course = courses.find(c => c.id === courseId);
    if (!course) return;

    activeCourseId = courseId;
    courseDialogTitle.textContent = course.name;
    chaptersList.innerHTML = '';

    course.chapters.forEach((chapter, index) => {
      const btn = document.createElement('button');
      btn.className = 'chapter-btn';
      btn.textContent = chapter.title || `Chapter ${index + 1}`;

      if (course.completedChapters.includes(index)) {
        btn.style.backgroundColor = '#4caf50';
      }

      btn.addEventListener('click', () =>
        selectChapter(courseId, index)
      );

      chaptersList.appendChild(btn);
    });

    courseDialog.showModal();
  }

  closeCourseBtn.addEventListener('click', () => {
    courseDialog.close();
  });

  // ===============================
  // SELECT CHAPTER
  // ===============================

  async function selectChapter(courseId, index) {
    const course = courses.find(c => c.id === courseId);
    if (!course) return;

    activeChapterIndex = index;

    const chapterText = course.chapters[index].content;

    summaryText.textContent = "Loading...";
    questionsText.textContent = "";
    summarySection.style.display = 'block';

    const blob = new Blob([chapterText], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', blob, 'chapter.txt');

    const response = await fetch(`${API_BASE}/summarize`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    summaryText.textContent = result.summary || "No summary.";
    questionsText.textContent = (result.questions || [])
      .map((q, i) => `${i + 1}. ${q}`)
      .join("\n");
  }

  // ===============================
  // GRADE ANSWER
  // ===============================

  submitAnswerBtn.addEventListener('click', async () => {
    const answer = answerInput.value.trim();
    if (!answer) return;

    const course = courses.find(c => c.id === activeCourseId);
    const chapterText = course.chapters[activeChapterIndex].content;

    const formData = new FormData();
    formData.append('chapter_text', chapterText);
    formData.append('answer', answer);

    const response = await fetch(`${API_BASE}/grade`, {
      method: 'POST',
      body: formData
    });

    const result = await response.json();
    const score = result.score;

    answerFeedback.textContent =
      `Score: ${score}/10\n\n${result.feedback}`;

    answerFeedback.style.color =
      score >= 6 ? '#4caf50' : '#f44336';

    if (!course.attempts[activeChapterIndex]) {
      course.attempts[activeChapterIndex] = [];
    }

    course.attempts[activeChapterIndex].push(score);

    if (score >= 6 &&
      !course.completedChapters.includes(activeChapterIndex)) {
      course.completedChapters.push(activeChapterIndex);
    }

    saveCourses();
    updateAnalytics();
  });

  renderCourses();
  updateAnalytics();

});
