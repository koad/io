Template.popup.onRendered(function () {
  const subtitle = document.getElementsByClassName("card-subtitle")[0];
  const createWord = (text, index) => {
    const word = document.createElement("span");
    word.innerHTML = `${text} `;
    word.classList.add("card-subtitle-word");
    word.style.transitionDelay = `${index * 40}ms`;
    return word;
  };

  const addWord = (text, index) => subtitle.appendChild(createWord(text, index));
  const createSubtitle = text => text.split(" ").map(addWord);
  console.log('creating words')
  createSubtitle("Dark Passenger");

  let btt = document.querySelector(".btn-configure-application");
  btt.addEventListener("click", () => {
      chrome.runtime.sendMessage("showOptions");
  });

});
