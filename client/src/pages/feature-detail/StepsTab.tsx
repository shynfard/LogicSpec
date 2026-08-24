interface Step {
  id: string;
  type: string;
  label: string;
  actor?: string;
}

export function StepsTab({ steps }: { steps: Step[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="p-2">id</th>
          <th className="p-2">type</th>
          <th className="p-2">label</th>
          <th className="p-2">actor</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.id} id={`step-${step.id}`} className="border-b">
            <td className="p-2">{step.id}</td>
            <td className="p-2">{step.type}</td>
            <td className="p-2">{step.label}</td>
            <td className="p-2">{step.actor ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
