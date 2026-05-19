// Step 1: Mapping of CPU models to their launch years
const cpuLaunchYears = {
	'E5-2695v4': 'Q1\'16',
	'E5-2640v4': 'Q1\'16',
	'E3-1280v5': 'Q4\'15',
	'E5-2690v2': 'Q3\'13',
	'E5-2640v1': 'Q1\'12',
	'E5-2630v1': 'Q1\'12',
	'E5-2660v1': 'Q1\'12',
	'E5-2630v2': 'Q3\'13',
	'E5-2680v2': 'Q3\'13',
	'E3-1241v3': 'Q2\'14',
	'E5-2670v3': 'Q3\'14',
	'E5-2680v1': 'Q1\'12',
	'E5-2650v2': 'Q3\'13',
	'E5-2630v3': 'Q3\'14',
	'E5-2660v2': 'Q3\'13',
	'E5-2440v1': 'Q2\'12',
	'E3-1220v2': 'Q2\'12',
	'E3-1230v2': 'Q2\'12',
	'E3-1280v2': 'Q2\'12',
	'E3-1231v3': 'Q2\'14'
};

// Function to append launch years to CPU descriptions
function appendLaunchYears() {
	// Step 2: Identify the table and rows. This is a placeholder selector.
	const rows = document.querySelectorAll('table tr');

	rows.forEach(row => {
		// Step 3: Extract CPU description. This assumes CPU model is directly in the row's text.
		const cpuText = row.textContent;
		const cpuModel = cpuText.match(/E\d-\d{4}v\d/g); // Simplified regex, may need refinement

		if (cpuModel) {
			console.log({cpuModel})
			cpuModel.forEach(model => {
				// Step 4: Append the launch year
				const launchYear = cpuLaunchYears[model];
				if (launchYear) {
					row.innerHTML = row.innerHTML.replace(model, `${model} (${launchYear})`);
				}
			});
		}
	});
}

// Run the function to modify the page content
appendLaunchYears();
