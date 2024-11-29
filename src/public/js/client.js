function incr(id) {
  const li = document.getElementById(id);
  if (li) {
    const valueSpan = li.querySelector(".value");
    let currentValue = parseInt(valueSpan.textContent.trim());
    valueSpan.textContent = ` ${currentValue + 1}`;
    fetch(`/counters/${id}/increment`, { method: "POST" });
  }
}

const socket = io();
const counters_list = document.getElementById("counters");

function addCounterItem(id, name, value, created_at) {
  const li = document.createElement("li");
  li.id = id;

  const outer_span = document.createElement("span");
  outer_span.className =
    "flex transition-[background-color] hover:bg-[#242424] active:bg-[#222] border-y border-[#313131] border-b-0";
  li.appendChild(outer_span);

  const outer_span2 = document.createElement("span");
  outer_span2.className = "py-3 flex grow items-center";
  outer_span.appendChild(outer_span2);

  const span_created_at = document.createElement("span");
  span_created_at.className =
    "w-32 inline-block self-start shrink-0 text-gray-500";
  span_created_at.textContent = created_at;
  outer_span2.appendChild(span_created_at);

  const span_name = document.createElement("span");
  span_name.classList = "grow text-gray-100";
  span_name.textContent = name;
  outer_span2.appendChild(span_name);

  const increment_button = document.createElement("button");
  increment_button.className = "flex items-center";
  increment_button.onclick = () => incr(id);

  const counter_value = document.createElement("span");
  counter_value.className = "value";
  counter_value.textContent = `${value}`;
  increment_button.appendChild(counter_value);
  increment_button.appendChild(document.createTextNode("++"));

  outer_span2.appendChild(increment_button);

  counters_list.appendChild(li);
}

fetch("/counters")
  .then((res) => res.json())
  .then((counters) => {
    counters.forEach((counter) => {
      addCounterItem(
        counter.id,
        counter.name,
        counter.value,
        counter.created_at,
      );
    });
  });

socket.emit("subscribe", "public");
socket.on("update", (counter) => {
  const li = document.getElementById(counter.id);
  if (li) {
    li.querySelector(".value").textContent = ` ${counter.value}`;
  } else {
    addCounterItem(counter.id, counter.name, counter.value, counter.created_at);
  }
});

// Listen for new counters
socket.on("new", (counter) => {
  addCounterItem(counter.id, counter.name, counter.value, counter.created_at);
});
